import { runSmokeProcess, smokePassed } from "./smoke-process.mjs";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tarball = resolve(process.argv[2] ?? join(root, "artifacts", `${pkg.name}-${pkg.version}.tgz`));
const testHome = mkdtempSync(join(tmpdir(), "riskproof-dsh-check-"));
const env = { ...process.env, DSH_HOME: testHome };
const dsh = process.env.DSH_BIN ?? "dsh";
const artifacts = join(root, "artifacts");
mkdirSync(artifacts, { recursive: true });
const run = (args) => {
  const result = spawnSync(dsh, args, { env, encoding: "utf8", timeout: 60000 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr + result.stdout);
  return result.stdout + result.stderr;
};
const evidence = { dsh: run(["--version"]).trim(), tarball, testHome, checks: [] };
evidence.sha256 = createHash("sha256").update(readFileSync(tarball)).digest("hex");
const versionSuffix = evidence.dsh.replace(/[^a-zA-Z0-9.-]/g, "_");
let hasSdkRpc = false;
for (const profile of ["web", "sdk"]) {
  run(["plugin", "--profile", profile, "add", tarball]);
  const config = run(["--profile", profile, "--dump-config"]);
  if (profile === "sdk") hasSdkRpc = config.includes("@deepseek-ai/dsh-sdk-jsonrpc-server");
  if (!/name: dsh-riskproof/.test(config)) throw new Error(`${profile}: missing RiskProof bundle`);
  writeFileSync(join(artifacts, `dsh-${profile}-composed.yml`), config);
  evidence.checks.push(`${profile}: exact tarball installed and bundle composed`);
}
// New hosts provide an SDK RPC profile; older hosts treat "sdk" as a custom
// base profile. Both exercise the real tools pipeline without TCP listeners.
const patch = join(testHome, "smoke.patch.yml");
writeFileSync(patch, `- id: tools\n  config:\n    mode: native\n- insert:\n    - id: riskproof-install-fixture\n      name: ${JSON.stringify(join(root, "scripts/dsh-smoke-fixture.mjs"))}\n`);
const result = await runSmokeProcess(dsh, ["--profile", "sdk", "--patch", patch], {
  env, shutdown: hasSdkRpc ? "jsonrpc" : "sigterm",
});
writeFileSync(join(artifacts, "dsh-install-check.log"), result.output);
writeFileSync(join(artifacts, `dsh-install-check-${versionSuffix}.log`), result.output);
const { output, ...lifecycle } = result;
evidence.lifecycle = lifecycle;
writeFileSync(join(artifacts, `dsh-install-lifecycle-${versionSuffix}.json`), JSON.stringify(lifecycle, null, 2) + "\n");
if (!smokePassed(result)) throw new Error(`DSH install check failed (${JSON.stringify(lifecycle)}): ${output}`);
evidence.checks.push(`${hasSdkRpc ? "sdk RPC" : "legacy base profile"}: real host boot, slash-command discovery/demo, task enforcement, output blocking, report tool, receipts, clean shutdown`);
// A boot marker alone does not prove that the dashboard's optional transport
// fiber registered a route. Exercise the exact installed package over HTTP.
const httpPatch = join(testHome, "dashboard-http.patch.yml");
const legacyHmr = evidence.dsh.startsWith("0.1.")
  ? readFileSync(join(root, "scripts/fixtures/ci-web-boot.patch.yml"), "utf8")
  : "";
writeFileSync(httpPatch, legacyHmr + `- insert:\n    - id: riskproof-dashboard-http-fixture\n      name: ${JSON.stringify(join(root, "scripts/fixtures/dashboard-http.mjs"))}\n`);
const webArgs = ["--profile", "web", "--patch", httpPatch, "--port", "0"];
if (evidence.dsh !== "0.1.0-rc.7") webArgs.push("--no-open");
const httpResult = await runSmokeProcess(dsh, webArgs, { env, shutdown: "sigterm", timeoutMs: 30000 });
const { output: httpOutput, ...httpLifecycle } = httpResult;
const redactedHttpOutput = httpOutput.replace(/\?token=\S+/g, "?token=[REDACTED]");
writeFileSync(join(artifacts, `dsh-dashboard-http-${versionSuffix}.log`), redactedHttpOutput);
writeFileSync(join(artifacts, `dsh-dashboard-http-lifecycle-${versionSuffix}.json`), JSON.stringify(httpLifecycle, null, 2) + "\n");
evidence.dashboardHttp = httpLifecycle;
if (!smokePassed(httpResult)) throw new Error(`DSH dashboard HTTP check failed (${JSON.stringify(httpLifecycle)}): ${redactedHttpOutput}`);
evidence.checks.push("web HTTP: dashboard RPC snapshot, zero tool activity, cross-site rejection, host browser authentication where supported, clean shutdown");
evidence.webBrowser = "Not covered: run a Web/browser check separately.";
writeFileSync(join(artifacts, "dsh-install-check.json"), JSON.stringify(evidence, null, 2) + "\n");
writeFileSync(join(artifacts, `dsh-install-check-${versionSuffix}.json`), JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence, null, 2));
