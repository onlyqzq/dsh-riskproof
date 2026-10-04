import type { Dashboard } from "../experience/dashboard.js";
import { styles } from "./styles.js";
import { panelTemplate, shield } from "./template.js";

interface PanelState {
  current: string | null;
  data: Dashboard | undefined;
  connected: boolean;
  loading: boolean;
  pulseUntil: number;
  reconnecting: boolean;
}

const colors = { clear: "#22866c", blocked: "#cc6655", attention: "#b67723" };

const element = (tag: string, className: string, text?: string) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Owns DOM construction and presentation; has no RPC or session subscriptions. */
export function createPanelView() {
  const root = element("div", "rp-root");
  const style = element("style", "rp-style");
  style.textContent = styles;
  root.innerHTML = panelTemplate;
  const find = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const panel = find<HTMLElement>(".rp-panel");
  const beacon = find<HTMLButtonElement>(".rp-beacon");
  const retry = find<HTMLButtonElement>(".rp-retry");

  function render({ current, data, connected, loading, pulseUntil, reconnecting }: PanelState) {
    const c = data?.counts;
    const status = !current ? "请选择对话"
      : !connected ? loading ? "正在同步当前对话" : "连接中断，等待恢复"
        : !data?.proofEnabled ? "证据记录已关闭"
          : data.mode === "observe" ? "仅观察，不主动拦截"
            : data.partial ? "部分检测已关闭"
              : c?.blocked ? `已拦截 ${c.blocked} 次风险`
                : c?.pending ? "工具执行中，等待回执"
                  : Date.now() < pulseUntil ? "已检查新的工具调用"
                    : c?.attention ? `${c.attention} 条记录需关注`
                      : c?.checked ? `已检查 ${c.checked} 次调用` : "等待工具调用";
    root.dataset.state = !current || !connected && loading ? "idle" : !connected ? "offline" : c?.blocked ? "blocked" : c?.pending || Date.now() < pulseUntil ? "working"
      : data?.mode === "observe" || data?.partial || !data?.proofEnabled || c?.attention ? "attention" : "ready";
    find(".rp-brand small").textContent = status;
    find(".rp-status").textContent = status;
    beacon.setAttribute("aria-label", `RiskProof：${status}。查看安全概览`);
    retry.hidden = !current || connected || loading;
    retry.disabled = reconnecting;
    retry.textContent = reconnecting ? "正在重连…" : "重新连接";
    find<HTMLElement>(".rp-data").hidden = !current || !connected || !data;
    if (!current || !data || !connected) return;

    const counts = data.counts;
    const task = data.taskMode === "read-only" ? "只读任务" : data.taskMode === "local-only" ? "本地任务" : "常规任务";
    find(".rp-scope").textContent = `任务范围：${task} · ${data.mode === "observe" ? "观察模式" : "执行防护"}`;
    find(".rp-footnote").textContent = `仅统计本次运行保留的当前会话记录（最多 ${data.limit} 条）。未触发规则不代表绝对安全。`;
    find(".rp-total strong").textContent = data.proofEnabled ? String(counts.checked) : "—";

    const legend = find(".rp-legend");
    legend.replaceChildren();
    const segments = find(".rp-segments");
    segments.replaceChildren();
    let offset = 0;
    const circumference = 2 * Math.PI * 51;
    for (const [key, label] of [["clear", "未触发风险"], ["blocked", "RiskProof 拦截"], ["attention", "需要关注"]] as const) {
      const row = element("div", "rp-legend-row");
      const dot = element("span", "rp-key");
      dot.style.background = colors[key];
      row.append(dot, element("span", "", label), element("strong", `rp-count-${key}`, String(counts[key])));
      legend.append(row);
      if (counts.checked && counts[key]) {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        const length = counts[key] / counts.checked * circumference;
        const attributes = {
          cx: "60",
          cy: "60",
          r: "51",
          stroke: colors[key],
          "stroke-dasharray": `${length} ${circumference - length}`,
          "stroke-dashoffset": String(-offset),
        };
        for (const [key, value] of Object.entries(attributes)) {
          circle.setAttribute(key, value);
        }
        segments.append(circle);
        offset += length;
      }
    }
    find(".rp-ring").setAttribute("aria-label", `已检查 ${counts.checked} 次：未触发风险 ${counts.clear}，RiskProof 拦截 ${counts.blocked}，需要关注 ${counts.attention}`);

    const activity = find(".rp-activity");
    activity.replaceChildren();
    for (let i = 0; i < 24; i++) {
      const item = data.activity[i];
      const bar = element("span", "rp-bar");
      if (item) {
        bar.dataset.kind = item.kind;
        bar.title = `${item.tool}（${item.at}）`;
      }
      activity.append(bar);
    }
    activity.setAttribute("aria-label", `最近 ${data.activity.length} 次真实工具检查；颜色与调用分布对应`);

    find(".rp-risk-count").textContent = data.risks.length ? `最近 ${data.risks.length} 条` : "";
    const risks = find(".rp-risks");
    risks.replaceChildren();
    for (const risk of data.risks) {
      const card = element("article", "rp-risk");
      card.dataset.kind = risk.kind;
      const title = element("div", "rp-risk-title");
      title.append(element("span", "", risk.title), element("span", "rp-tag", risk.outcome));
      card.append(title);
      const flow = element("div", "rp-flow");
      flow.setAttribute("aria-label", "风险来源链");
      const nodes = [...risk.sources, risk.tool];
      nodes.forEach((name, i) => {
        if (i) flow.append(element("span", "", "→"));
        const node = element("span", "rp-node", name);
        node.title = name;
        flow.append(node);
      });
      card.append(flow);
      card.title = risk.rule;
      risks.append(card);
    }
    if (!data.risks.length) {
      const empty = element("div", "rp-empty");
      empty.innerHTML = shield;
      empty.append(element("strong", "", !data.proofEnabled ? "证据记录已关闭" : counts.checked ? "暂未发现需关注的记录" : "等待第一条工具记录"), element("p", "", !data.proofEnabled ? "启用插件的 proof.enabled 配置后，可查看调用记录。" : "开始日常任务后，这里会自动更新。"));
      risks.append(empty);
    }

    const notices = [!data.proofEnabled ? "证据记录已关闭，图表不代表实际调用数量。" : "", data.partial ? "部分检测已关闭，请检查插件配置。" : ""].filter(Boolean);
    const notice = find<HTMLElement>(".rp-notice");
    notice.textContent = notices.join(" ");
    notice.hidden = !notices.length;
  }

  return { root, style, panel, beacon, retry, find, render };
}
