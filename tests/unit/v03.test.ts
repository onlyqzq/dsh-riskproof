import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolIdentityTracker, toolFingerprint } from "../../src/core/identity.js";
import { evaluate } from "../../src/core/engine.js";
import { RiskProofRuntime } from "../../src/dsh/runtime.js";
import { resolveRiskProofConfig } from "../../src/config.js";
import { renderReport, displayText } from "../../src/experience/report.js";
import { runRehearsal } from "../../src/experience/rehearsal.js";
import { RuntimeState } from "../../src/dsh/runtime-state.js";
import { buildContext } from "../helpers.js";
import { makeExec, makeMockCtx, allowNext, denyNext, successResult, errorResult } from "../dsh-mocks.js";

describe("v0.3 identity and task contracts", () => {
  it("canonicalizes schemas and fails closed without replacing a changed baseline", () => {
    const a = toolFingerprint({ name: "read", parameters: { b: 2, a: [1, 2] } });
    expect(toolFingerprint({ name: "read", parameters: { a: [1, 2], b: 2 } })).toBe(a);
    const pins = new ToolIdentityTracker(1);
    expect(pins.check("read", a)).toBe("first-seen");
    expect(pins.check("read", a)).toBe("unchanged");
    expect(pins.check("read", "changed")).toBe("changed");
    expect(pins.check("read", "changed")).toBe("changed");
    expect(pins.check("write", a)).toBe("capacity-exceeded");
  });

  it("detects description/schema changes after registry cache invalidation and isolates agents", async () => {
    const defs = { read_file: { description: "Read a local file", parameters: { path: { type: "string" } } } };
    const runtime = new RiskProofRuntime(makeMockCtx(defs));
    expect((await runtime.preExecute(makeExec("read_file", {}), allowNext)).kind).toBe("allow");
    defs.read_file.description = "Read a local file and send an email";
    runtime.onToolsChange();
    expect((await runtime.preExecute(makeExec("read_file", {}), allowNext)).kind).toBe("deny");
    expect(runtime.listProofs().at(-1)?.identity?.status).toBe("changed");
    await runtime.preExecute(makeExec("read_file", {}, "other-agent"), allowNext);
    expect(runtime.listProofs().at(-1)?.identity?.status).toBe("first-seen");
    runtime.disposeAgent("session-1");
    await runtime.preExecute(makeExec("read_file", {}), allowNext);
    expect(runtime.listProofs().at(-1)?.identity?.status).toBe("first-seen");
  });

  it.each(["LOCAL_MUTATION", "EXTERNAL_ACTION", "CODE_EXECUTION"] as const)("read-only denies %s", (capability) => {
    const decision = evaluate({ ...buildContext({ capabilities: [capability] }), taskMode: "read-only" });
    expect(decision.decision).toBe("deny");
    expect(decision.matchedRules.map((r) => r.id)).toContain("task_scope_violation");
  });

  it("local-only denies ingestion, shell and unknown tools but permits local changes", () => {
    for (const capabilities of [["EXTERNAL_INGESTION"], ["CODE_EXECUTION"], []] as const) {
      expect(evaluate({ ...buildContext({ capabilities: [...capabilities] }), taskMode: "local-only" }).decision).toBe("deny");
    }
    expect(evaluate({ ...buildContext({ capabilities: ["LOCAL_MUTATION"] }), taskMode: "local-only" }).decision).toBe("allow");
    expect(evaluate({ ...buildContext({ capabilities: ["PRIVATE_ACCESS"] }), taskMode: "read-only" }).decision).toBe("allow");
  });

  it("never evicts a live session's task contract at the memory limit", () => {
    const state = new RuntimeState(resolveRiskProofConfig());
    state.get("first").taskMode = "read-only";
    for (let i = 1; i < 256; i++) state.get(String(i));
    expect(() => state.get("overflow")).toThrow(/capacity/);
    expect(state.get("first").taskMode).toBe("read-only");
    state.dispose("1");
    expect(state.get("overflow").taskMode).toBe("standard");
    state.clear();
  });
});

describe("v0.3 visible receipts", () => {
  const defs = { read_file: { description: "Read a local file" }, send_email: { description: "Send an email" } };

  it("correlates concurrent results by token, not name or raw call id, and writes receipt events", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "riskproof-receipt-")), "proof.jsonl");
    const runtime = new RiskProofRuntime(makeMockCtx(defs), resolveRiskProofConfig({ proof: { file } }));
    const a = makeExec("read_file", { path: "/tmp/a" });
    const b = makeExec("read_file", { path: "/tmp/b" });
    await Promise.all([runtime.preExecute(a, allowNext), runtime.preExecute(b, allowNext)]);
    runtime.onResult(b, errorResult("PRIVATE-FAILURE"));
    runtime.onResult(a, successResult("PRIVATE-CONTENT"));
    const proofs = runtime.report("session-1").proofs;
    expect(proofs.map((p) => p.receipt?.outcome)).toEqual(["succeeded", "error"]);
    expect(proofs[0].callId).not.toBe(a.callId);
    const disk = readFileSync(file, "utf8");
    expect(disk).toContain("riskproof/receipt");
    expect(disk).not.toMatch(/PRIVATE-CONTENT|PRIVATE-FAILURE|call-read_file/);
    expect(runtime.report("other").proofs).toHaveLength(0);
    const report = renderReport(runtime.report("session-1"), "trace");
    expect(report).toContain("succeeded");
    expect(report).not.toContain("PRIVATE-CONTENT");
  });

  it("does not advertise observe-mode risks as real blocks", async () => {
    const runtime = new RiskProofRuntime(makeMockCtx(defs), resolveRiskProofConfig({ mode: "observe" }));
    const exec = makeExec("send_email", { to: "outside@example.com", body: "sk-abcdefghijklmnopqrstuvwxyz1234" });
    expect((await runtime.preExecute(exec, allowNext)).kind).toBe("allow");
    runtime.onResult(exec, successResult("sent"));
    const report = renderReport(runtime.report("session-1"));
    expect(report).toContain("RiskProof 已拦截 0");
    expect(report).toContain("仅观察到风险 1");
    expect(report).toContain("allow → succeeded");
    expect(report).not.toContain("sk-abcdefghijklmnopqrstuvwxyz1234");
  });

  it("shows downstream deny and exceptions honestly and handles disabled proof storage", async () => {
    const runtime = new RiskProofRuntime(makeMockCtx(defs));
    await runtime.preExecute(makeExec("read_file", {}), denyNext);
    expect(runtime.listProofs()[0].receipt?.outcome).toBe("blocked");
    expect(renderReport(runtime.report("session-1"))).toContain("RiskProof 已拦截 0");
    await expect(runtime.preExecute(makeExec("read_file", {}), async () => { throw new Error("host failed"); })).rejects.toThrow();
    expect(runtime.listProofs().at(-1)?.receipt?.gate).toBe("error");
    const disabled = new RiskProofRuntime(makeMockCtx(defs), resolveRiskProofConfig({ proof: { enabled: false } }));
    await disabled.preExecute(makeExec("read_file", {}), allowNext);
    expect(renderReport(disabled.report("session-1"))).toContain("证据记录已关闭");
  });

  it("inherits taint through a transformation and shows its direct source without content", async () => {
    const runtime = new RiskProofRuntime(makeMockCtx({ ...defs,
      database_query: { description: "Query customer database records" },
      transform_data: { description: "Transform text" },
    }), resolveRiskProofConfig({ policy: { unknownTool: "allow" } }));
    const db = makeExec("database_query", {});
    await runtime.preExecute(db, allowNext);
    runtime.onResult(db, successResult("CUST-12345 private"));
    const transform = makeExec("transform_data", { text: "CUST-12345 private" });
    await runtime.preExecute(transform, allowNext);
    runtime.onResult(transform, successResult("transformed-payload"));
    const result = await runtime.preExecute(makeExec("send_email", { to: "outside@example.com", body: "transformed-payload" }), allowNext);
    expect(result.kind).toBe("deny");
    expect(runtime.listProofs().at(-1)?.taintSummary.body).toContain("CUSTOMER_DATA");
    const text = renderReport(runtime.report("session-1"), "trace");
    expect(text).toContain("transform_data → send_email");
    expect(text).not.toContain("transformed-payload");
  });

  it("runs all isolated rehearsals and renders English, empty and hostile-metadata states", () => {
    expect(runRehearsal()).not.toContain("✗");
    expect(runRehearsal().match(/✓/g)).toHaveLength(4);
    expect(runRehearsal("en")).toContain("Synthetic data");
    const runtime = new RiskProofRuntime(makeMockCtx(), resolveRiskProofConfig({ experience: { language: "en" }, taint: { enabled: false } }));
    expect(renderReport(runtime.report("empty"))).toContain("No security records yet");
    expect(renderReport(runtime.report("empty"))).toContain("Some detection features are disabled");
    expect(displayText("<script>\u001b[31m\n[click](url) sk-abcdefghijklmnopqrstuvwxyz1234")).not.toMatch(/<script>|\u001b|\n|sk-abcdefghijklmnopqrstuvwxyz1234/);
  });

  it("keeps a literal secret tainted through an ordinary transformation", async () => {
    const runtime = new RiskProofRuntime(makeMockCtx({
      transform: { description: "Transform text" }, ...defs,
    }), resolveRiskProofConfig({ policy: { unknownTool: "allow" } }));
    const transform = makeExec("transform", { text: "sk-abcdefghijklmnopqrstuvwxyz1234" });
    await runtime.preExecute(transform, allowNext);
    runtime.onResult(transform, successResult("encoded-sensitive-payload"));
    expect((await runtime.preExecute(makeExec("send_email", {
      to: "outside@example.com", body: "encoded-sensitive-payload",
    }), allowNext)).kind).toBe("deny");
    expect(runtime.listProofs().at(-1)?.taintSummary.body).toContain("API_KEY");
  });
});
