// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apply } from "../../src/client/panel.js";
import { dashboard, type Dashboard } from "../../src/experience/dashboard.js";
import { RiskProofRuntime } from "../../src/dsh/runtime.js";
import { makeMockCtx } from "../dsh-mocks.js";

const base = (): Dashboard => dashboard(new RiskProofRuntime(makeMockCtx()).report("a"), "a");
const $ = (selector: string) => document.querySelector<HTMLElement>(selector)!;
const settle = async () => { await vi.advanceTimersByTimeAsync(0); };
function mount(response = base()) {
  let current: string | undefined = "a"; let subscription = () => {}; let dispose = () => {};
  const events = new Map<string, (...args: unknown[]) => void>();
  const call = vi.fn(async () => ({ ok: true, value: response }));
  const unsubscribe = vi.fn();
  apply({
    sessions: { list: { getSnapshot: () => ({ current }), subscribe: callback => { subscription = callback; return unsubscribe; } } },
    connection: { rpc: { call } },
    on: (event, callback) => events.set(event, callback),
    effect: callback => { dispose = callback(); },
  });
  return { call, events, dispose: () => dispose(), unsubscribe, select: (id?: string) => { current = id; subscription(); } };
}
beforeEach(() => { vi.useFakeTimers(); Object.defineProperty(document, "hidden", { configurable: true, value: false }); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); document.body.replaceChildren(); document.head.replaceChildren(); });

describe("live beacon safety and lifecycle", () => {
  it("stays closed during actual updates, renders bounded text safely, and clears command content", async () => {
    const state = base(); const ui = mount(state); await settle();
    expect($('.rp-panel').hidden).toBe(true); expect($('.rp-brand small').textContent).toContain("等待工具调用");
    $('.rp-beacon').click(); await settle(); expect($('.rp-panel').hidden).toBe(false);
    $('.rp-close').click();
    state.counts = { checked: 2, clear: 1, blocked: 1, attention: 0, succeeded: 1, pending: 0 };
    state.activity = [{ id: "p", at: "2026-09-10", kind: "blocked", tool: "bash" }];
    state.risks = [{ id: "p", kind: "blocked", title: '<img src=x onerror="bad()">', sources: ["web_fetch"], tool: "bash", rule: "untrusted_code_execution", outcome: "已阻止执行" }];
    await vi.advanceTimersByTimeAsync(1000);
    expect($('.rp-root').dataset.state).toBe("blocked"); expect($('.rp-panel').hidden).toBe(true);
    expect($('.rp-count-blocked').textContent).toBe("1"); expect(document.querySelector('img')).toBeNull();
    expect($('.rp-risk-title').textContent).toContain("<img"); expect($('.rp-flow').textContent).toBe("web_fetch→bash");
    expect($('.rp-ring').getAttribute('aria-label')).toContain("已检查 2");
    expect(document.querySelectorAll('.rp-segments circle')).toHaveLength(2);
    ui.events.get('command/executed')?.('a', 'unrelated', { text: 'ignore' }); expect($('.rp-panel').hidden).toBe(true);
    ui.events.get('command/executed')?.('other', 'riskproof', { text: 'ignore' }); expect($('.rp-panel').hidden).toBe(true);
    ui.events.get('command/executed')?.('a', 'riskproof', { text: 'x'.repeat(60000) });
    expect($('.rp-details pre').textContent).toHaveLength(48000);
    expect($('.rp-details').hasAttribute('open')).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect($('.rp-panel').hidden).toBe(true); expect($('.rp-details pre').textContent).toBe('');
    $('.rp-beacon').click(); await settle();
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); expect($('.rp-panel').hidden).toBe(true);
    ui.dispose(); expect(document.querySelector('.rp-root')).toBeNull(); expect(document.querySelector('.rp-style')).toBeNull(); expect(ui.unsubscribe).toHaveBeenCalledOnce();
  });
  it("discards late responses after switching sessions and does not retain old risks on disconnect", async () => {
    const ui = mount(); await settle();
    let reply: (value: { ok: boolean; value: Dashboard }) => void = () => {};
    ui.call.mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }));
    const tick = vi.advanceTimersByTimeAsync(1000); await Promise.resolve(); await tick;
    ui.call.mockResolvedValue({ ok: true, value: { ...base(), sessionId: 'b' } });
    ui.select('b'); await settle();
    reply({ ok: true, value: { ...base(), counts: { ...base().counts, checked: 99 } } }); await settle();
    expect($('.rp-total strong').textContent).toBe('0');
    ui.call.mockRejectedValue(new Error('offline')); await vi.advanceTimersByTimeAsync(1000);
    expect($('.rp-root').dataset.state).toBe('offline'); expect($('.rp-data').hidden).toBe(true);
    ui.call.mockResolvedValue({ ok: true, value: { ...base(), sessionId: 'b' } }); await vi.advanceTimersByTimeAsync(1000);
    expect($('.rp-root').dataset.state).toBe('ready');
    ui.dispose();
  });
  it("shows observation, partial detection and disabled recording without a false protection claim", async () => {
    const state = base(); state.mode = 'observe'; const ui = mount(state); await settle();
    expect($('.rp-brand small').textContent).toContain('不主动拦截');
    state.mode = 'enforce'; state.partial = true; await vi.advanceTimersByTimeAsync(1000);
    expect($('.rp-brand small').textContent).toContain('部分检测');
    state.proofEnabled = false; await vi.advanceTimersByTimeAsync(1000);
    expect($('.rp-total strong').textContent).toBe('—'); expect($('.rp-notice').textContent).toContain('记录已关闭');
    state.proofEnabled = true; state.partial = false; state.counts.pending = 1; await vi.advanceTimersByTimeAsync(1000);
    expect($('.rp-root').dataset.state).toBe('working');
    state.counts.pending = 0; state.counts.attention = 1; await vi.advanceTimersByTimeAsync(1000);
    expect($('.rp-root').dataset.state).toBe('attention');
    state.counts.attention = 0; state.counts.checked = 1; state.counts.clear = 1;
    state.activity = [{ id: 'new', kind: 'clear', tool: 'read', at: 'now' }]; await vi.advanceTimersByTimeAsync(1000);
    expect($('.rp-brand small').textContent).toContain('已检查新的');
    await vi.advanceTimersByTimeAsync(2000); expect($('.rp-brand small').textContent).toContain('已检查 1');
    state.sessionId = null; ui.select(); await settle(); expect($('.rp-brand small').textContent).toContain('请选择对话');
    ui.dispose();
  });
  it("pauses hidden-tab reads, resumes when visible, and rejects mismatched snapshots", async () => {
    const ui = mount(); await settle(); const count = ui.call.mock.calls.length;
    Object.defineProperty(document, 'hidden', { value: true, configurable: true }); await vi.advanceTimersByTimeAsync(3000);
    expect(ui.call.mock.calls).toHaveLength(count);
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    ui.call.mockResolvedValue({ ok: true, value: { ...base(), sessionId: 'wrong' } });
    document.dispatchEvent(new Event('visibilitychange')); await settle(); expect($('.rp-root').dataset.state).toBe('offline');
    ui.call.mockResolvedValue({ ok: false, value: base() }); await vi.advanceTimersByTimeAsync(1000); expect($('.rp-root').dataset.state).toBe('offline');
    ui.dispose();
  });
});
