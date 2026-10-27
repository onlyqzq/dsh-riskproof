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
    ctx.provide("webServer", {});
    const runtime = new RiskProofRuntime(makeMockCtx({ read_file: { description: "Read file" } }));
    const exec = makeExec("read_file", { path: "private.txt" });
    await runtime.preExecute(exec, allowNext); runtime.onResult(exec, successResult("private body"));
    const fiber = ctx.plugin((inner: Context) => installDashboard(inner, runtime)); await fiber;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(handle).toHaveBeenCalledOnce(); expect(handle.mock.calls[0][0]).toBe('/riskproof');
    expect(handle).toHaveBeenCalledWith('/riskproof', expect.any(Function), { authority: 'loopback' });
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
  it("waits for a late HTTP carrier before registering the authenticated channel", async () => {
    const ctx = new Context();
    const dispose = vi.fn(async () => {});
    const handle = vi.fn(() => dispose);
    ctx.provide("connection", { rpc: { handle } });
    const fiber = ctx.plugin((inner: Context) => installDashboard(inner, new RiskProofRuntime(makeMockCtx())));
    await fiber;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(handle).not.toHaveBeenCalled();
    ctx.provide("webServer", {});
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(handle).toHaveBeenCalledExactlyOnceWith('/riskproof', expect.any(Function), { authority: 'loopback' });
    await fiber.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
  it("keeps minimal hosts working without the optional connection RPC service", async () => {
    const ctx = new Context(); ctx.provide('connection', {}); ctx.provide('webServer', {});
    const fiber = ctx.plugin((inner: Context) => installDashboard(inner, new RiskProofRuntime(makeMockCtx())));
    await fiber; await fiber.dispose();
  });
});

interface RegisteredRoute {
  path: string;
  methods: readonly string[];
  requestBody: string;
  fetch(request: Request): Promise<Response>;
}

async function modern(runtime = new RiskProofRuntime(makeMockCtx()), carrierReady = true) {
  const ctx = new Context();
  let route: RegisteredRoute | undefined;
  const dispose = vi.fn(async () => {});
  const register = vi.fn((value: RegisteredRoute) => { route = value; return dispose; });
  const handle = vi.fn();
  ctx.provide('connection', { fetch: { register }, rpc: { handle } });
  if (carrierReady) ctx.provide('webServer', {});
  const fiber = ctx.plugin((inner: Context) => installDashboard(inner, runtime));
  await fiber;
  await new Promise(resolve => setTimeout(resolve, 0));
  const send = (body: unknown, options: RequestInit = {}) => route!.fetch(new Request('http://localhost/api/riskproof/status', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...options,
  }));
  return { ctx, fiber, register, handle, dispose, get route() { return route!; }, send };
}

const envelope = (payload: unknown = { sessionId: 'session-1' }) => ({
  type: 'client-request', rpcId: 'test-call', method: 'riskproof/status', payload,
});

describe('host dashboard exact Fetch route', () => {
  it('waits for the carrier, registers one exact buffered POST route and disposes it', async () => {
    const host = await modern(undefined, false);
    expect(host.register).not.toHaveBeenCalled();
    host.ctx.provide('webServer', {});
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(host.register).toHaveBeenCalledOnce();
    expect(host.route).toMatchObject({ path: '/api/riskproof/status', methods: ['POST'], requestBody: 'buffered' });
    expect(host.handle).not.toHaveBeenCalled();
    await host.fiber.dispose();
    expect(host.dispose).toHaveBeenCalledOnce();
  });

  it('returns the redacted RPC envelope without changing receipts or allocating session activity', async () => {
    const runtime = new RiskProofRuntime(makeMockCtx({ read_file: { description: 'Read file' } }));
    const exec = makeExec('read_file', { path: 'private-path-marker' });
    await runtime.preExecute(exec, allowNext);
    runtime.onResult(exec, successResult('private-body-marker'));
    const before = runtime.report('session-1');
    const host = await modern(runtime);
    try {
      for (const [sessionId, checked] of [['session-1', 1], ['other', 0], [null, 0]] as const) {
        const response = await host.send(envelope({ sessionId }));
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
        expect(response.headers.get('cache-control')).toBe('no-store');
        const result = await response.json();
        expect(result).toMatchObject({ type: 'server-response', rpcId: 'test-call', result: { ok: true, value: { sessionId, counts: { checked } } } });
        expect(JSON.stringify(result)).not.toContain('private-');
      }
      expect(runtime.report('session-1')).toEqual(before);
    } finally { await host.fiber.dispose(); }
  });

  it('rejects invalid JSON, protocol, session, method and content type without reflecting input', async () => {
    const host = await modern();
    try {
      const cases: Array<[unknown, RequestInit, number]> = [
        [envelope(), { body: '{"private-error-marker":' }, 400],
        [{ ...envelope(), type: 'private-error-marker' }, {}, 400],
        [{ ...envelope(), method: 'private-error-marker' }, {}, 400],
        [{ ...envelope(), rpcId: '' }, {}, 400],
        [{ ...envelope(), rpcId: 'private-error-marker'.repeat(30) }, {}, 400],
        [envelope({ sessionId: 'private-error-marker'.repeat(30) }), {}, 400],
        [envelope({ sessionId: 7 }), {}, 400],
        [envelope({ sessionId: '' }), {}, 400],
        [envelope({}), {}, 400],
        [envelope(), { method: 'GET', body: undefined }, 405],
        [envelope(), { headers: { 'content-type': 'text/plain' } }, 415],
      ];
      for (const [body, options, expected] of cases) {
        const response = await host.send(body, options);
        expect(response.status).toBe(expected);
        expect(response.headers.get('cache-control')).toBe('no-store');
        const text = await response.text();
        expect(JSON.parse(text)).toMatchObject({ type: 'server-response', result: { ok: false } });
        expect(text).not.toContain('private-error-marker');
      }
      expect((await host.send(envelope(), { headers: { 'content-type': 'Application/JSON; charset=utf-8' } })).status).toBe(200);
    } finally { await host.fiber.dispose(); }
  });

  it('caps actual streaming bytes even without a content length and ignores private read errors', async () => {
    const runtime = new RiskProofRuntime(makeMockCtx());
    const host = await modern(runtime);
    try {
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new TextEncoder().encode('private-size-marker'.repeat(500)));
      }, cancel });
      const request = new Request('http://localhost/api/riskproof/status', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body, duplex: 'half',
      } as RequestInit);
      const response = await host.route.fetch(request);
      expect(response.status).toBe(413);
      expect(cancel).toHaveBeenCalledOnce();
      expect(await response.text()).not.toContain('private-size-marker');
      expect((await host.send(envelope(), { headers: { 'content-type': 'application/json', 'content-length': '8193' } })).status).toBe(413);
      const json = JSON.stringify(envelope());
      const padded = json + ' '.repeat(8192 - Buffer.byteLength(json));
      expect((await host.send(envelope(), { body: padded })).status).toBe(200);
      // The cap applies to bytes, not JavaScript string length.
      expect((await host.send({ ...envelope(), ignored: '秘'.repeat(3000) })).status).toBe(413);
      const broken = new ReadableStream<Uint8Array>({ start(controller) {
        controller.error(new Error('private-stream-marker'));
      } });
      const brokenRequest = new Request('http://localhost/api/riskproof/status', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: broken, duplex: 'half',
      } as RequestInit);
      const readFailure = await host.route.fetch(brokenRequest);
      expect(readFailure.status).toBe(400);
      expect(await readFailure.text()).not.toContain('private-stream-marker');
      const spy = vi.spyOn(runtime, 'report').mockImplementationOnce(() => { throw new Error('private-runtime-marker'); });
      const failed = await host.send(envelope());
      expect(failed.status).toBe(500);
      expect(await failed.text()).not.toContain('private-runtime-marker');
      spy.mockRestore();
    } finally { await host.fiber.dispose(); }
  });
});
