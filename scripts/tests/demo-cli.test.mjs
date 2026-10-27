import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../../dist/demo.js", import.meta.url));

function isolated(t) {
  const cwd = mkdtempSync(join(tmpdir(), "riskproof-demo-artifact-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const run = (args = [], entry = cli) => spawnSync(process.execPath, [entry, ...args], {
    cwd,
    // Deliberately omit HOME, DSH_HOME, API keys, NODE_OPTIONS and host configuration.
    env: {},
    encoding: "utf8",
    timeout: 15_000,
  });
  return { cwd, run };
}

test("published demo runs in a clean directory with no host environment or generated files", (t) => {
  const { cwd, run } = isolated(t);
  const result = run(["--json", "--language", "en"]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout);
  assert.equal(report.synthetic, true);
  assert.equal(report.policy, "balanced");
  assert.equal(report.language, "en");
  assert.equal(report.passed, true);
  assert.equal(report.cases.length, 4);
  for (const entry of report.cases) {
    assert.equal(entry.passed, true);
    assert.equal(entry.decision, "deny");
    assert.ok(entry.matchedRules.includes(entry.rule));
  }
  assert.doesNotMatch(result.stdout, /SYNTHETIC-CUSTOMER|demo@example\.com|echo riskproof-demo/);
  assert.deepEqual(readdirSync(cwd), []);
});

test("published demo explains the synthetic scope and installation next step in both languages", (t) => {
  const { run } = isolated(t);
  for (const [args, title, boundary, next] of [
    [[], "防护演练", "演示不计入真实拦截数量", "下一步：安装到 DSH"],
    [["--language", "en"], "Protection rehearsal", "Rehearsal is excluded from live counts", "Next: install into DSH"],
  ]) {
    const result = run(args);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    for (const text of [title, boundary, next, "dsh plugin --profile web add dsh-riskproof"]) {
      assert.ok(result.stdout.includes(text));
    }
    assert.equal((result.stdout.match(/✓ /g) ?? []).length, 4);
    assert.ok(!result.stdout.includes("✗"));
  }
  const help = run(["--help"]);
  assert.equal(help.status, 0);
  assert.equal(help.stderr, "");
  assert.match(help.stdout, /Usage: riskproof-demo/);
  assert.match(help.stdout, /--language zh-CN\|en/);
  assert.match(help.stdout, /No DSH profile or model API key is needed/);
});

test("published demo rejects invalid options with nonzero status and no input reflection", (t) => {
  const { run } = isolated(t);
  for (const args of [["private-input-marker"], ["--language"],
    ["--language", "private-input-marker"], ["--json", "--json"]]) {
    const result = run(args);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /无效/);
    assert.doesNotMatch(result.stderr, /private-input-marker/);
  }
});

test("published demo is recognized as the main entry through an npm-style bin symlink", (t) => {
  const { cwd, run } = isolated(t);
  const bin = join(cwd, "riskproof-demo");
  symlinkSync(cli, bin);
  const result = run(["--json"], bin);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).passed, true);
});
