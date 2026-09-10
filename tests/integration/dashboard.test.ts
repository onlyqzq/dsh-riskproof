import { describe, expect, it, vi } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { installDashboard } from "../../src/dsh/dashboard.js";
import { RiskProofRuntime } from "../../src/dsh/runtime.js";
import { makeMockCtx, makeExec, allowNext, successResult } from "../dsh-mocks.js";

describe("host dashboard RPC lifecycle", () => {
  it("registers one read-only authenticated channel and disposes it with the plugin", async () => {
    const ctx = new Context();
    const dispose = vi.fn(async () => {});
    let handler: (endpoint: string, payload: unknown) => Promise<unknown> = async () => {};
    const handle = vi.fn((_channel: string, callback: typeof handler) => { handler = callback; return dispose; });
    ctx.provide("connection", { rpc: { handle } });
    const runtime = new RiskProofRuntime(makeMockCtx({ read_file: { description: "Read file" } }));
    const exec = makeExec("read_file", { path: "private.txt" });
    await runtime.preExecute(exec, allowNext); runtime.onResult(exec, successResult("private body"));
    const fiber = ctx.plugin((inner: Context) => installDashboard(inner, runtime)); await fiber;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(handle).toHaveBeenCalledOnce(); expect(handle.mock.calls[0][0]).toBe('/riskproof');
    for (const payload of [null, {}, { sessionId: 3 }, { sessionId: '' }, { sessionId: 'x'.repeat(257) }]) {
      expect(await handler('status', payload)).toMatchObject({ ok: false });
    }
    expect(await handler('change-policy', { sessionId: 'session-1' })).toMatchObject({ ok: false });
    expect(await handler('status', { sessionId: null })).toMatchObject({ ok: true, value: { counts: { checked: 0 } } });
    const result = await handler('status', { sessionId: 'session-1' });
    expect(result).toMatchObject({ ok: true, value: { counts: { checked: 1 } } });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(await handler('status', { sessionId: 'other' })).toMatchObject({ ok: true, value: { counts: { checked: 0 } } });
    await fiber.dispose(); expect(dispose).toHaveBeenCalledOnce();
  });
  it("keeps minimal hosts working without the optional connection RPC service", async () => {
    const ctx = new Context(); ctx.provide('connection', {});
    const fiber = ctx.plugin((inner: Context) => installDashboard(inner, new RiskProofRuntime(makeMockCtx())));
    await fiber; await fiber.dispose();
  });
});
