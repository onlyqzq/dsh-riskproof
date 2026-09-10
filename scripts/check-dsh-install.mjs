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
evidence.checks.push(`${hasSdkRpc ? "sdk RPC" : "legacy base profile"}: real host boot, slash-command discovery/demo, task enforcement, report tool, receipts, clean shutdown`);
evidence.webBrowser = "Not covered: run a Web/browser check separately.";
writeFileSync(join(artifacts, "dsh-install-check.json"), JSON.stringify(evidence, null, 2) + "\n");
writeFileSync(join(artifacts, `dsh-install-check-${versionSuffix}.json`), JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence, null, 2));
