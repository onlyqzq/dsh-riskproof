import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRiskProofConfig } from "../../src/config.js";
import { RiskProofRuntime } from "../../src/dsh/runtime.js";
import { protectionHealth, renderHealthReport } from "../../src/experience/health.js";
import { makeMockCtx } from "../dsh-mocks.js";

const report = (config: unknown = {}) => new RiskProofRuntime(makeMockCtx(), resolveRiskProofConfig(config)).report("a");

describe("read-only protection diagnostics", () => {
  it("explains balanced defaults without inventing activity or a safety score", () => {
    const result = protectionHealth(report());
    expect(result.attention).toBe(0);
    expect(result.checks).toHaveLength(9);
    expect(result.checks.find(c => c.id === "activity")).toMatchObject({ status: "info" });
    expect(result.checks.find(c => c.id === "activity")?.detail).toContain("尚无保留记录");
    expect(result.checks.find(c => c.id === "retention")?.detail).toContain("仅在内存");
    expect(result.note).toContain("不替代宿主兼容性");
    expect(result).not.toHaveProperty("score");
  });

  it("reports disabled features and precise recovery actions", () => {
    const snapshot = report({ mode: "observe", proof: { enabled: false }, provenance: { enabled: false },
      taint: { enabled: false }, toolchain: { enabled: false }, output: { enabled: false } });
    const result = protectionHealth(snapshot);
    expect(result.attention).toBe(6);
    expect(result.checks.filter(c => c.status === "attention").every(c => c.action)).toBe(true);
    expect(result.checks.find(c => c.id === "activity")?.detail).toContain("无法判断");
    expect(renderHealthReport(snapshot)).toContain("mode: enforce");
  });

  it("finds missing credential labels even when output gating is enabled", () => {
    const result = protectionHealth(report({ output: { blockedTaints: ["PII"] } }));
    expect(result.attention).toBe(1);
    expect(result.checks.find(c => c.id === "credential-output")).toMatchObject({ status: "attention" });
    expect(result.checks.find(c => c.id === "credential-output")?.detail).toContain("SECRET, API_KEY");
  });

  it("compares effective overrides rather than trusting the strict preset label", () => {
    const snapshot = report({ policy: { preset: "strict", untrustedCodeExecution: "allow" } });
    expect(snapshot.relaxedPolicyRules).toEqual(["untrustedCodeExecution"]);
    expect(protectionHealth(snapshot).checks.find(c => c.id === "policy-posture")).toMatchObject({ status: "attention" });
    expect(protectionHealth(report({ policy: { preset: "strict" } })).attention).toBe(0);
    expect(protectionHealth(report({ policy: { preset: "permissive" } })).attention).toBe(1);
  });

  it("marks omitted fields as unknown for old snapshots", () => {
    const snapshot = report(); delete snapshot.outputBlockedTaints; delete snapshot.relaxedPolicyRules;
    const result = protectionHealth(snapshot);
    expect(result.checks.find(c => c.id === "credential-output")?.status).toBe("info");
    expect(result.checks.find(c => c.id === "policy-posture")?.status).toBe("info");
  });

  it("never exposes operator paths, domains or declassifier names or creates persistence files", () => {
    const file = join(mkdtempSync(join(tmpdir(), "riskproof-health-")), "private-proof.jsonl");
    const runtime = new RiskProofRuntime(makeMockCtx(), resolveRiskProofConfig({
      proof: { file }, policy: { internalDomains: ["private.acme.internal"], sensitivePathPatterns: ["/private/keys"] },
      output: { trustedDeclassifiers: { private_redactor: ["SECRET"] } },
    }));
    for (let i = 0; i < 300; i++) protectionHealth(runtime.report(String(i)));
    runtime.setTaskMode("active", "read-only");
    expect(runtime.report("active").taskMode).toBe("read-only");
    const text = renderHealthReport(runtime.report("active"));
    for (const secret of [file, "private.acme.internal", "/private/keys", "private_redactor"]) expect(text).not.toContain(secret);
    expect(text).toContain("未验证文件可写性");
    expect(existsSync(file)).toBe(false);
    expect(runtime.listProofs()).toEqual([]);
  });

  it("localizes findings and separates observe mode from configured output blocking", () => {
    const snapshot = report({ experience: { language: "en" }, mode: "observe" });
    const result = protectionHealth(snapshot);
    expect(result.attention).toBe(1);
    expect(result.checks.find(c => c.id === "credential-output")?.detail).toContain("enforcement still depends on mode");
    const text = renderHealthReport(snapshot);
    expect(text).toContain("Protection checks");
    expect(text).toContain("no tool execution");
    expect(text).not.toMatch(/[\u4e00-\u9fff]/);
  });
});
