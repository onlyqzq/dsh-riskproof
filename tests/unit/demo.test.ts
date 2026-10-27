import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runDemoCli } from "../../src/demo.js";
import * as rehearsal from "../../src/experience/rehearsal.js";

function invoke(args: string[]) {
  let stdout = "";
  let stderr = "";
  const code = runDemoCli(args, {
    write: (text) => { stdout += text; },
    error: (text) => { stderr += text; },
  });
  return { code, stdout, stderr };
}

describe("synthetic protection demo CLI", () => {
  it("checks all expected rules with the real engine and preserves the slash command text", () => {
    const results = rehearsal.runRehearsalResults();
    expect(results).toMatchObject({ synthetic: true, policy: "balanced", language: "zh-CN", passed: true });
    expect(results.cases).toHaveLength(4);
    for (const result of results.cases) {
      expect(result.decision).toBe("deny");
      expect(result.matchedRules).toContain(result.rule);
      expect(result.passed).toBe(true);
    }
    expect(rehearsal.runRehearsal()).toBe(rehearsal.renderRehearsal(results));
    const result = invoke([]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("🛡 RiskProof · 防护演练");
    expect(result.stdout).toContain("演示不计入真实拦截数量");
    expect(result.stdout).toContain("dsh plugin --profile web add dsh-riskproof");
    expect(result.stderr).toBe("");
  });

  it("supports English text and machine-readable results without live-session content", () => {
    expect(invoke(["--language", "en"]).stdout).toContain("Rehearsal is excluded from live counts.");
    const result = invoke(["--json", "--language", "en"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(rehearsal.runRehearsalResults("en"));
    expect(result.stdout).not.toContain("SYNTHETIC-CUSTOMER");
    expect(result.stdout).not.toContain("demo@example.com");
    expect(result.stdout).not.toContain("echo riskproof-demo");
    expect(result.stderr).toBe("");
  });

  it("shows help and rejects unsupported or incomplete options without echoing them", () => {
    expect(invoke(["--help"]).stdout).toContain("Usage: riskproof-demo");
    for (const args of [["private-marker"], ["--language"], ["--language", "private-marker"],
      ["--json", "--json"], ["--help", "private-marker"]]) {
      const result = invoke(args);
      expect(result.code).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("无效");
      expect(result.stderr).not.toContain("private-marker");
    }
  });

  it("returns failure when a rule regresses or evaluation cannot complete", () => {
    const results = rehearsal.runRehearsalResults("en");
    results.passed = false;
    results.cases[0] = { ...results.cases[0], decision: "allow", passed: false, matchedRules: [] };
    const spy = vi.spyOn(rehearsal, "runRehearsalResults").mockReturnValueOnce(results);
    try {
      const failure = invoke(["--json", "--language", "en"]);
      expect(failure.code).toBe(1);
      expect(JSON.parse(failure.stdout).passed).toBe(false);
      spy.mockImplementationOnce(() => { throw new Error("private-error-marker"); });
      const error = invoke([]);
      expect(error.code).toBe(1);
      expect(error.stdout).toBe("");
      expect(error.stderr).not.toContain("private-error-marker");
      expect(error.stderr).toContain("未能完成");
    } finally {
      spy.mockRestore();
    }
  });

  it("runs as a process without a DSH profile, model configuration or host boot", () => {
    const result = spawnSync(process.execPath,
      ["--import", "tsx", fileURLToPath(new URL("../../src/demo.ts", import.meta.url)), "--json"],
      { cwd: fileURLToPath(new URL("../..", import.meta.url)), encoding: "utf8",
        env: { PATH: process.env.PATH } });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ synthetic: true, policy: "balanced", passed: true });
  });
});
