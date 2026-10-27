import type { Context } from "@deepseek-ai/cordis";
import type { RiskProofRuntime } from "./runtime.js";
import { dashboard, type Dashboard } from "../experience/dashboard.js";

interface FetchRoute {
  path: string;
  methods: readonly ["POST"];
  requestBody: "buffered";
  fetch(request: Request): Promise<Response>;
}

interface RpcHost {
  fetch?: { register(route: FetchRoute): () => Promise<void> };
  rpc?: {
    handle(channel: string, handler: (endpoint: string, payload: unknown) => Promise<unknown>,
      options?: { authority: "loopback" }): () => Promise<void>;
  };
}

type DashboardResult = { ok: true; value: Dashboard } | {
  ok: false; error: { code: string; message: string; details: Record<string, never> };
};

const MAX_BODY_BYTES = 8 * 1024;
const ROUTE = "/api/riskproof/status";
const failure = (code = "bad-request", message = "Expected a session status request"): DashboardResult =>
  ({ ok: false, error: { code, message, details: {} } });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

class BodyTooLarge extends Error {}

/** Keep our own small cap even when a host uses a larger buffered-body limit. */
async function readJson(request: Request): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > MAX_BODY_BYTES) throw new BodyTooLarge();
  if (!request.body) throw new Error();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new BodyTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}

function response(result: DashboardResult, rpcId = "invalid-request", status = 200): Response {
  return new Response(JSON.stringify({ type: "server-response", rpcId, result }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
      ...(status === 405 ? { Allow: "POST" } : {}) },
  });
}

/** Uses the host's admission/owner fence; no additional server, auth bypass or model tool. */
export function installDashboard(ctx: Context, runtime: RiskProofRuntime): void {
  // Newer hosts provide Connection before its optional HTTP carrier is ready.
  // Register only once both exist; a failed early registration is not retried.
  ctx.inject(["connection", "webServer"], inner => {
    const connection = (inner as unknown as { connection: RpcHost }).connection;
    const status = async (endpoint: string, payload: unknown): Promise<DashboardResult> => {
      const sessionId = isRecord(payload) ? payload.sessionId : undefined;
      if (endpoint !== "status" || !(sessionId === null || typeof sessionId === "string" && sessionId.length > 0 && sessionId.length <= 256)) {
        return failure();
      }
      // report() is read-only and does not allocate state, resume an agent, or read history.
      try {
        return { ok: true, value: dashboard(runtime.report(sessionId ?? undefined), sessionId) };
      } catch {
        return failure("internal", "Could not read session status");
      }
    };
    const fetch = connection.fetch;
    if (fetch?.register) {
      // Exact routes are admitted by Connection's shared /api carrier. Newer hosts
      // additionally restrict them to owner Peers before calling this handler.
      inner.effect(() => fetch.register({
        path: ROUTE, methods: ["POST"], requestBody: "buffered",
        async fetch(request) {
          if (new URL(request.url).pathname !== ROUTE) return response(failure(), undefined, 404);
          if (request.method !== "POST") return response(failure(), undefined, 405);
          if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
            return response(failure(), undefined, 415);
          }
          let message: unknown;
          try {
            message = await readJson(request);
          } catch (error) {
            return response(failure(), undefined, error instanceof BodyTooLarge ? 413 : 400);
          }
          if (!isRecord(message) || typeof message.rpcId !== "string" || !message.rpcId.length || message.rpcId.length > 256) {
            return response(failure(), undefined, 400);
          }
          if (message.type !== "client-request" || message.method !== "riskproof/status") {
            return response(failure(), message.rpcId, 400);
          }
          const result = await status("status", message.payload);
          return response(result, message.rpcId, result.ok ? 200 : result.error.code === "bad-request" ? 400 : 500);
        },
      }));
    } else if (connection.rpc?.handle) {
      // rc.7/rc.8 require explicit loopback authority and retain their Host/Origin fence.
      inner.effect(() => connection.rpc!.handle("/riskproof", status, { authority: "loopback" }));
    }
  });
}
