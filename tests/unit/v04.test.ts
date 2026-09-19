import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateOutputFlow } from "../../src/core/output-policy.js";
import { resolveRiskProofConfig } from "../../src/config.js";
import { RiskProofRuntime } from "../../src/dsh/runtime.js";
import { dashboard } from "../../src/experience/dashboard.js";
import { renderReport } from "../../src/experience/report.js";
import { allowNext, errorResult, makeExec, makeMockCtx, successResult } from "../dsh-mocks.js";

const acceptNext = async () => ({ kind: "accept" as const });

describe("v0.4 output-side information-flow control", () => {
  it("blocks configured output labels", () => {
    const decision = evaluateOutputFlow(
      "get_secret",
      [],
      ["SECRET"],
      [],
      { enabled: true, blockedTaints: ["SECRET", "API_KEY"], trustedDeclassifiers: {} },
    );
    expect(decision.action).toBe("block");
    expect(decision.blockedTaints).toEqual(["SECRET"]);
  });

  it("lets only a pinned tool remove inherited labels", () => {
    const policy = {
      enabled: true,
      blockedTaints: ["CUSTOMER_DATA" as const],
      trustedDeclassifiers: { redact_customer: ["CUSTOMER_DATA" as const] },
    };
    expect(evaluateOutputFlow("ordinary_transform", ["CUSTOMER_DATA"], [], [], policy).action).toBe("block");
    const redacted = evaluateOutputFlow("redact_customer", ["CUSTOMER_DATA"], [], [], policy);
    expect(redacted.action).toBe("allow");
    expect(redacted.declassifiedTaints).toEqual(["CUSTOMER_DATA"]);
  });

  it("restores a declassified label when the returned value is still sensitive", () => {
    const decision = evaluateOutputFlow(
      "redact_customer",
      ["PII"],
      [],
      ["PII"],
      {
        enabled: true,
        blockedTaints: ["PII"],
        trustedDeclassifiers: { redact_customer: ["PII"] },
      },
    );
    expect(decision.action).toBe("block");
    expect(decision.declassifiedTaints).toEqual(["PII"]);
    expect(decision.taints).toContain("PII");
  });

  it("keeps propagation additive when output control is disabled", () => {
    const decision = evaluateOutputFlow(
      "approved_redactor",
      ["PII"],
      [],
      [],
      {
        enabled: false,
        blockedTaints: ["PII"],
        trustedDeclassifiers: { approved_redactor: ["PII"] },
      },
    );
    expect(decision.action).toBe("allow");
    expect(decision.taints).toEqual(["PII"]);
    expect(decision.declassifiedTaints).toEqual([]);
  });

  it("blocks credential output before it reaches the model and records a redacted receipt", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "riskproof-output-")), "proof.jsonl");
    const runtime = new RiskProofRuntime(makeMockCtx({
      get_secret: { description: "Read a credential from the secret vault" },
    }), resolveRiskProofConfig({ proof: { file } }));
    const exec = makeExec("get_secret", {});
    await runtime.preExecute(exec, allowNext);
    const post = await runtime.postExecute(exec, successResult("opaque-credential-value"), acceptNext);
    expect(post.kind).toBe("block");
    runtime.onResult(exec, errorResult("blocked by output policy"));
    const proof = runtime.listProofs()[0];
    expect(proof.receipt?.outcome).toBe("output_blocked");
    expect(proof.receipt?.output).toEqual({
      action: "block",
      taints: ["SECRET"],
      declassifiedTaints: [],
    });
    expect(JSON.stringify(proof)).not.toContain("opaque-credential-value");
    const persisted = readFileSync(file, "utf8");
    expect(persisted).toContain('"action":"block"');
    expect(persisted).toContain('"outcome":"output_blocked"');
    expect(persisted).not.toContain("opaque-credential-value");
  });

  it("propagates the reduced label set after trusted declassification", async () => {
    const runtime = new RiskProofRuntime(makeMockCtx({
      customer_database: { description: "Query private customer records" },
      approved_redactor: { description: "Produce an approved aggregate" },
      send_email: { description: "Send an email message" },
    }), resolveRiskProofConfig({
      policy: { unknownTool: "allow" },
      output: { trustedDeclassifiers: { approved_redactor: ["CUSTOMER_DATA"] } },
    }));
    const source = makeExec("customer_database", {});
    await runtime.preExecute(source, allowNext);
    runtime.onResult(source, successResult("CUST-12345 private"));

    const redact = makeExec("approved_redactor", { value: "CUST-12345 private" });
    await runtime.preExecute(redact, allowNext);
    expect((await runtime.postExecute(redact, successResult("aggregate-42"), acceptNext)).kind).toBe("accept");
    runtime.onResult(redact, successResult("aggregate-42"));
    expect(runtime.listProofs().at(-1)?.receipt?.output?.declassifiedTaints).toContain("CUSTOMER_DATA");

    const send = await runtime.preExecute(makeExec("send_email", {
      to: "outside@example.com",
      body: "aggregate-42",
    }), allowNext);
    expect(send.kind).toBe("allow");
  });

  it("keeps output policy advisory in observe mode", async () => {
    const runtime = new RiskProofRuntime(makeMockCtx({
      get_secret: { description: "Read a credential from the secret vault" },
    }), resolveRiskProofConfig({ mode: "observe" }));
    const exec = makeExec("get_secret", {});
    await runtime.preExecute(exec, allowNext);
    expect((await runtime.postExecute(exec, successResult("opaque"), acceptNext)).kind).toBe("accept");
    runtime.onResult(exec, successResult("opaque"));
    expect(runtime.listProofs()[0].receipt?.output?.action).toBe("would_block");
    expect(runtime.listProofs()[0].receipt?.outcome).toBe("succeeded");
    expect(renderReport(runtime.report("session-1"))).toContain("仅观察到风险 1");
    expect(dashboard(runtime.report("session-1"), "session-1").counts.attention).toBe(1);
  });

  it("inspects a downstream replacement before accepting it", async () => {
    const runtime = new RiskProofRuntime(makeMockCtx({
      safe_tool: { description: "Return a static status" },
    }), resolveRiskProofConfig({ policy: { unknownTool: "allow" } }));
    const exec = makeExec("safe_tool", {});
    await runtime.preExecute(exec, allowNext);
    const decision = await runtime.postExecute(exec, successResult("safe"), async () => ({
      kind: "accept" as const,
      value: "api_key=supersecretvalue123",
    }));
    expect(decision.kind).toBe("block");
  });
});
