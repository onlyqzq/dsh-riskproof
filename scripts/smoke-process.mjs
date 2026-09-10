import { spawn } from "node:child_process";

/** A functional marker is necessary, but never substitutes for a clean exit. */
export function runSmokeProcess(command, args, { env, shutdown, timeoutMs = 20000, killGraceMs = 2000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let stderr = "";
    let stdout = "";
    let passed = false;
    let acknowledged = false;
    let timedOut = false;
    let forceTimer;
    let pipeError;
    const terminate = signal => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) { if (error.code !== "ESRCH") pipeError = error.message; }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate("SIGTERM");
      forceTimer = setTimeout(() => terminate("SIGKILL"), killGraceMs);
    }, timeoutMs);
    child.stderr.on("data", data => {
      const text = data.toString(); output += text; stderr += text;
      if (passed || !/(?:^|\n)RISKPROOF_INSTALL_CHECK_OK\r?\n/.test(stderr)) return;
      passed = true;
      if (shutdown === "jsonrpc") {
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: "riskproof-shutdown", method: "shutdown", params: {} }) + "\n");
      } else {
        // Legacy profiles have no SDK RPC listener. The DSH launcher handles
        // SIGTERM by disposing its root runtime and exiting with code 0.
        child.kill("SIGTERM");
      }
    });
    child.stdout.on("data", data => {
      const text = data.toString(); output += text; stdout += text;
      const lines = stdout.split("\n"); stdout = lines.pop();
      for (const line of lines) {
        try {
          const message = JSON.parse(line);
          if (message.id === "riskproof-shutdown" && Object.hasOwn(message, "result") && !message.error) acknowledged = true;
        } catch { /* Non-protocol diagnostics cannot acknowledge shutdown. */ }
      }
    });
    child.stdin.on("error", error => { pipeError = error.message; });
    child.once("error", error => { clearTimeout(timer); clearTimeout(forceTimer); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timer); clearTimeout(forceTimer);
      resolve({ output, passed, code, signal, timedOut, shutdown, acknowledged, ...(pipeError ? { pipeError } : {}) });
    });
  });
}

export function smokePassed(result) {
  return result.passed && result.code === 0 && result.signal === null && !result.timedOut &&
    (result.shutdown !== "jsonrpc" || result.acknowledged);
}
