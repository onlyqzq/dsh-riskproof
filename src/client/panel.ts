import type { Dashboard } from "../experience/dashboard.js";
import { styles } from "./styles.js";
export const inject = ["commandUi", "sessions", "connection"];
interface ClientContext {
  sessions: { list: { getSnapshot(): { current?: string }; subscribe(callback: () => void): () => void } };
  connection: { rpc: { call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{ ok: boolean; value?: unknown }> } };
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  effect(callback: () => () => void): unknown;
}
const shield = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.1 3 7.5 7.5 9.5 4.5-2 7.5-5.4 7.5-9.5V6L12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m8.5 11.5 2.4 2.4 4.7-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const colors = { clear: "#22866c", blocked: "#cc6655", attention: "#b67723" };
const element = (tag: string, className: string, text?: string) => {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function apply(ctx: ClientContext): void {
  const root = element("div", "rp-root");
  const style = element("style", "rp-style"); style.textContent = styles;
  // This template is static. All runtime metadata is assigned with textContent.
  root.innerHTML = `<section class="rp-panel" id="riskproof-panel" role="region" aria-label="当前对话安全概览" hidden>
    <div class="rp-head"><div><div class="rp-eyebrow">RISKPROOF / LIVE</div><h2 class="rp-title">当前对话安全概览</h2></div><button class="rp-close" aria-label="收起安全概览">×</button></div>
    <div class="rp-status"></div><div class="rp-data">
    <div class="rp-overview"><div class="rp-ring" role="img"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="51" stroke="var(--rp-line)"/><g class="rp-segments"></g></svg><div class="rp-total"><strong>0</strong><span>已检查调用</span></div></div><div class="rp-legend"></div></div>
    <div class="rp-section-label">调用活动<small>最近 24 次</small></div><div class="rp-activity" role="img"></div>
    <div class="rp-section-label">最近风险<small class="rp-risk-count"></small></div><div class="rp-risks"></div>
    <div class="rp-notice" hidden></div></div>
    <details class="rp-details" hidden><summary>查看本次命令输出</summary><pre></pre></details>
    </section><button class="rp-beacon" aria-label="RiskProof 当前对话安全状态" aria-controls="riskproof-panel" aria-expanded="false"><span class="rp-orb">${shield}</span><span class="rp-brand"><strong>RiskProof</strong><small aria-live="polite"></small></span><span class="rp-dot"></span></button>`;
  const find = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const panel = find<HTMLElement>(".rp-panel"); const beacon = find<HTMLButtonElement>(".rp-beacon");
  let current: string | null = null; let data: Dashboard | undefined; let connected = false;
  let disposed = false; let controller: AbortController | undefined; let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pulseUntil = 0; let lastId: string | undefined;
  const setOpen = (open: boolean, restoreFocus = true) => {
    panel.hidden = !open; beacon.setAttribute("aria-expanded", String(open));
    if (open) { find<HTMLButtonElement>(".rp-close").focus(); void refresh(); }
    else { find(".rp-details pre").textContent = ""; find<HTMLElement>(".rp-details").hidden = true; find(".rp-details").removeAttribute("open"); if (restoreFocus) beacon.focus(); }
  };
  function render() {
    const c = data?.counts;
    const status = !connected ? "连接中断，等待恢复"
      : !current ? "请选择对话"
        : !data?.proofEnabled ? "证据记录已关闭"
          : data.mode === "observe" ? "仅观察，不主动拦截"
            : data.partial ? "部分检测已关闭"
              : c?.blocked ? `已拦截 ${c.blocked} 次风险`
                : c?.pending ? "工具执行中，等待回执"
                : Date.now() < pulseUntil ? "已检查新的工具调用"
                  : c?.attention ? `${c.attention} 条记录需关注`
                      : c?.checked ? `已检查 ${c.checked} 次调用` : "等待工具调用";
    root.dataset.state = !connected ? "offline" : c?.blocked ? "blocked" : c?.pending || Date.now() < pulseUntil ? "working"
      : data?.mode === "observe" || data?.partial || !data?.proofEnabled || c?.attention ? "attention" : "ready";
    find(".rp-brand small").textContent = status; find(".rp-status").textContent = status;
    beacon.setAttribute("aria-label", `RiskProof：${status}。查看安全概览`);
    find<HTMLElement>(".rp-data").hidden = !connected || !data;
    if (!data || !connected) return;
    find(".rp-total strong").textContent = data.proofEnabled ? String(c!.checked) : "—";
    const legend = find(".rp-legend"); legend.replaceChildren();
    const segments = find(".rp-segments"); segments.replaceChildren();
    let offset = 0; const circumference = 2 * Math.PI * 51;
    for (const [key, label] of [["clear", "未触发风险"], ["blocked", "RiskProof 拦截"], ["attention", "需要关注"]] as const) {
      const row = element("div", "rp-legend-row"); const dot = element("span", "rp-key"); dot.style.background = colors[key];
      row.append(dot, element("span", "", label), element("strong", `rp-count-${key}`, String(c![key]))); legend.append(row);
      if (c!.checked && c![key]) {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        const length = c![key] / c!.checked * circumference;
        for (const [k, v] of Object.entries({ cx: "60", cy: "60", r: "51", stroke: colors[key], "stroke-dasharray": `${length} ${circumference - length}`, "stroke-dashoffset": String(-offset) })) circle.setAttribute(k, v);
        segments.append(circle); offset += length;
      }
    }
    find(".rp-ring").setAttribute("aria-label", `已检查 ${c!.checked} 次：未触发风险 ${c!.clear}，RiskProof 拦截 ${c!.blocked}，需要关注 ${c!.attention}`);
    const activity = find(".rp-activity"); activity.replaceChildren();
    for (let i = 0; i < 24; i++) {
      const item = data.activity[i]; const bar = element("span", "rp-bar");
      if (item) { bar.dataset.kind = item.kind; bar.title = `${item.tool}（${item.at}）`; }
      activity.append(bar);
    }
    activity.setAttribute("aria-label", `最近 ${data.activity.length} 次真实工具检查；颜色与调用分布对应`);
    find(".rp-risk-count").textContent = data.risks.length ? `最近 ${data.risks.length} 条` : "";
    const risks = find(".rp-risks"); risks.replaceChildren();
    for (const risk of data.risks) {
      const card = element("article", "rp-risk"); card.dataset.kind = risk.kind;
      const title = element("div", "rp-risk-title"); title.append(element("span", "", risk.title), element("span", "rp-tag", risk.outcome)); card.append(title);
      const flow = element("div", "rp-flow"); flow.setAttribute("aria-label", "风险来源链");
      const nodes = [...risk.sources, risk.tool];
      nodes.forEach((name, i) => {
        if (i) flow.append(element("span", "", "→"));
        const node = element("span", "rp-node", name); node.title = name; flow.append(node);
      });
      card.append(flow); card.title = risk.rule; risks.append(card);
    }
    if (!data.risks.length) {
      const empty = element("div", "rp-empty"); empty.innerHTML = shield;
      empty.append(element("strong", "", c!.checked ? "暂未发现需关注的记录" : "等待第一条工具记录"), element("p", "", "开始日常任务后，这里会自动更新。")); risks.append(empty);
    }
    const notices = [!data.proofEnabled ? "证据记录已关闭，图表不代表实际调用数量。" : "", data.partial ? "部分检测已关闭，请检查插件配置。" : ""].filter(Boolean);
    const notice = find<HTMLElement>(".rp-notice"); notice.textContent = notices.join(" "); notice.hidden = !notices.length;
  }
  async function refresh() {
    if (disposed || document.hidden || controller) return;
    const version = generation; const requested = current;
    const request = new AbortController(); controller = request;
    const timeout = setTimeout(() => request.abort(), 4000);
    try {
      const response = await ctx.connection.rpc.call("/riskproof", "status", { sessionId: requested }, request.signal);
      if (disposed || generation !== version) return;
      if (!response.ok || !response.value || typeof response.value !== "object") throw new Error("unavailable");
      const next = response.value as Dashboard;
      if (next.sessionId !== requested || !next.counts || !Array.isArray(next.risks)) throw new Error("invalid snapshot");
      const latest = next.activity.at(-1)?.id;
      if (connected && latest && latest !== lastId) pulseUntil = Date.now() + 1600;
      lastId = latest; data = next; connected = true;
    } catch {
      if (!disposed && generation === version) { connected = false; data = undefined; lastId = undefined; pulseUntil = 0; }
    } finally {
      clearTimeout(timeout);
      if (controller === request) controller = undefined;
      if (!disposed) render();
    }
  }
  const selection = () => {
    const id = ctx.sessions.list.getSnapshot().current ?? null;
    if (id === current) return;
    generation++; controller?.abort(); controller = undefined; current = id; data = undefined;
    connected = false; pulseUntil = 0; lastId = undefined;
    find(".rp-details pre").textContent = ""; find<HTMLElement>(".rp-details").hidden = true; find(".rp-details").removeAttribute("open");
    render(); void refresh();
  };
  const visibility = () => { if (!document.hidden) void refresh(); };
  const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !panel.hidden) setOpen(false); };
  const outside = (event: PointerEvent) => { if (!panel.hidden && event.target instanceof Node && !root.contains(event.target)) { setOpen(false, false); } };
  beacon.addEventListener("click", () => setOpen(panel.hidden)); find(".rp-close").addEventListener("click", () => setOpen(false));
  ctx.effect(() => {
    document.head.append(style); document.body.append(root);
    const unsubscribe = ctx.sessions.list.subscribe(selection);
    document.addEventListener("visibilitychange", visibility); document.addEventListener("keydown", escape); document.addEventListener("pointerdown", outside);
    const tick = async () => { await refresh(); if (!disposed) timer = setTimeout(tick, 1000); };
    selection(); render(); void tick();
    return () => { disposed = true; generation++; controller?.abort(); clearTimeout(timer); unsubscribe(); document.removeEventListener("visibilitychange", visibility); document.removeEventListener("keydown", escape); document.removeEventListener("pointerdown", outside); root.remove(); style.remove(); };
  });
  ctx.on("command/executed", (...args) => {
    const [sessionId, name, result] = args;
    if (name !== "riskproof" || sessionId !== current) return;
    // Commands remain a secondary entry; ordinary calls never open the panel.
    setOpen(true);
    if (result && typeof result === "object" && "text" in result && typeof result.text === "string") {
      find(".rp-details pre").textContent = result.text.slice(0, 48000);
      find<HTMLElement>(".rp-details").hidden = false;
    }
  });
}
