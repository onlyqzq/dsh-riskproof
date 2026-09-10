import type { Context } from "@deepseek-ai/cordis";
import type { RiskProofRuntime } from "./runtime.js";
import { dashboard } from "../experience/dashboard.js";

interface RpcHost {
  rpc?: {
    handle(channel: string, handler: (endpoint: string, payload: unknown) => Promise<unknown>): () => Promise<void>;
  };
}

/** Uses the host's authenticated RPC transport; no additional server or model tool. */
export function installDashboard(ctx: Context, runtime: RiskProofRuntime): void {
  ctx.inject(["connection"], inner => {
    const connection = (inner as unknown as { connection: RpcHost }).connection;
    if (!connection.rpc?.handle) return; // Older/headless hosts retain commands and report tool.
    inner.effect(() => connection.rpc!.handle("/riskproof", async (endpoint, payload) => {
      const sessionId = typeof payload === "object" && payload !== null && "sessionId" in payload
        ? payload.sessionId : undefined;
      if (endpoint !== "status" || !(sessionId === null || typeof sessionId === "string" && sessionId.length > 0 && sessionId.length <= 256)) {
        return { ok: false, error: { code: "bad-request", message: "Expected a session status request", details: {} } };
      }
      // report() is read-only and does not allocate state, resume an agent, or read history.
      return { ok: true, value: dashboard(runtime.report(sessionId ?? undefined), sessionId) };
    }));
  });
}
