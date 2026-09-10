import { test } from "node:test";
import assert from "node:assert/strict";
import { runSmokeProcess, smokePassed } from "../smoke-process.mjs";
const marker = 'process.stderr.write("RISKPROOF_INSTALL_CHECK_OK\\n");';
const run = (source, shutdown = "sigterm", timeoutMs = 3000) => runSmokeProcess(process.execPath, ["-e", source], { env: process.env, shutdown, timeoutMs, killGraceMs: 100 });

test("legacy profile exits cleanly via SIGTERM without an RPC listener", async () => {
  const result = await run(`process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000); ${marker}`);
  assert(smokePassed(result)); assert.equal(result.acknowledged, false);
});
test("SDK shutdown requires its protocol acknowledgment and clean exit", async () => {
  const result = await run(`process.stdin.on('data', data => { const m = JSON.parse(data); process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:m.id, result:{}})+'\\n', () => process.exit(0)); }); ${marker}`, "jsonrpc");
  assert(smokePassed(result)); assert(result.acknowledged);
});
test("success marker alone cannot hide a hung host or forced termination", async () => {
  const result = await run(`process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); ${marker}`, "jsonrpc", 500);
  assert(!smokePassed(result)); assert(result.passed); assert(result.timedOut); assert.equal(result.signal, "SIGKILL");
});
test("natural exit without assertions, and nonzero exit after assertions, both fail", async () => {
  assert(!smokePassed(await run("process.exit(0)")));
  assert(!smokePassed(await run(`process.on('SIGTERM', () => process.exit(2)); setInterval(() => {}, 1000); ${marker}`)));
});
test("SDK exit without response does not count as verified shutdown", async () => {
  assert(!smokePassed(await run(`process.stdin.on('data', () => process.exit(0)); ${marker}`, "jsonrpc")));
});
test("a split marker is recognized while report text containing the marker is not", async () => {
  const result = await run(`process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000); process.stderr.write('RISKPROOF_INSTALL_'); setTimeout(() => process.stderr.write('CHECK_OK\\n'), 20);`);
  assert(smokePassed(result));
  assert(!smokePassed(await run(`process.stderr.write('report: RISKPROOF_INSTALL_CHECK_OK\\n');`)));
});
