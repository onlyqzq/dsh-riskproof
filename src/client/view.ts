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

  let language = document.documentElement.lang.toLowerCase().startsWith("en") ? "en" : "zh-CN";

  function render({ current, data, connected, loading, pulseUntil, reconnecting }: PanelState) {
    // Keep the last known language through disconnects and session switches.
    if (data?.language === "en" || data?.language === "zh-CN") language = data.language;
    const t = (cn: string, en: string) => language === "en" ? en : cn;
    root.lang = language;
    const heading = t("当前对话安全概览", "Conversation security overview");
    find(".rp-title").textContent = heading;
    panel.setAttribute("aria-label", heading);
    find(".rp-close").setAttribute("aria-label", t("收起安全概览", "Close security overview"));
    find(".rp-total span").textContent = t("已检查调用", "Checked calls");
    find(".rp-activity-label").textContent = t("调用活动", "Tool activity");
    find(".rp-activity-limit").textContent = t("最近 24 次", "Last 24 checks");
    find(".rp-risks-label").textContent = t("最近风险", "Recent risks");
    find(".rp-health-label").textContent = t("防护检查", "Protection checks");
    find(".rp-details summary").textContent = t("查看本次命令输出", "View command output");
    const c = data?.counts;
    const status = !current ? t("请选择对话", "Select a conversation")
      : !connected ? loading ? t("正在同步当前对话", "Syncing conversation") : t("连接中断，等待恢复", "Disconnected; awaiting recovery")
        : !data?.proofEnabled ? t("证据记录已关闭", "Proof recording is disabled")
          : data.mode === "observe" ? t("仅观察，不主动拦截", "Observe only; no active blocking")
            : data.partial ? t("部分检测已关闭", "Some checks are disabled")
              : c?.blocked ? t(`已拦截 ${c.blocked} 次风险`, `Blocked ${c.blocked} risky calls`)
                : c?.pending ? t("工具执行中，等待回执", "Tool running; awaiting receipt")
                  : Date.now() < pulseUntil ? t("已检查新的工具调用", "New tool call checked")
                    : data?.health?.attention ? t(`${data.health.attention} 项配置需关注`, `${data.health.attention} configuration checks need attention`)
                      : c?.attention ? t(`${c.attention} 条记录需关注`, `${c.attention} records need attention`)
                      : c?.checked ? t(`已检查 ${c.checked} 次调用`, `Checked ${c.checked} calls`) : t("等待工具调用", "Waiting for tool calls");
    root.dataset.state = !current || !connected && loading ? "idle" : !connected ? "offline" : c?.blocked ? "blocked" : c?.pending || Date.now() < pulseUntil ? "working"
      : data?.mode === "observe" || data?.partial || !data?.proofEnabled || c?.attention || data?.health?.attention ? "attention" : "ready";
    find(".rp-brand small").textContent = status;
    find(".rp-status").textContent = status;
    beacon.setAttribute("aria-label", t(`RiskProof：${status}。查看安全概览`, `RiskProof: ${status}. View security overview`));
    retry.hidden = !current || connected || loading;
    retry.disabled = reconnecting;
    retry.textContent = reconnecting ? t("正在重连…", "Reconnecting…") : t("重新连接", "Reconnect");
    find<HTMLElement>(".rp-data").hidden = !current || !connected || !data;
    if (!current || !data || !connected) return;

    const counts = data.counts;
    const task = data.taskMode === "read-only" ? t("只读任务", "Read-only task") : data.taskMode === "local-only" ? t("本地任务", "Local-only task") : t("常规任务", "Standard task");
    find(".rp-scope").textContent = t(`任务范围：${task} · ${data.mode === "observe" ? "观察模式" : "执行防护"}`, `Task scope: ${task} · ${data.mode === "observe" ? "Observe mode" : "Execution protection"}`);
    find(".rp-footnote").textContent = t(`仅统计本次运行保留的当前会话记录（最多 ${data.limit} 条）。未触发规则不代表绝对安全。`, `Counts cover retained records for this conversation in this run (global limit ${data.limit}). No triggered rule does not establish safety.`);
    find(".rp-total strong").textContent = data.proofEnabled ? String(counts.checked) : "—";

    const legend = find(".rp-legend");
    legend.replaceChildren();
    const segments = find(".rp-segments");
    segments.replaceChildren();
    let offset = 0;
    const circumference = 2 * Math.PI * 51;
    for (const [key, label] of [["clear", t("未触发风险", "No risk triggered")], ["blocked", t("RiskProof 拦截", "RiskProof blocked")], ["attention", t("需要关注", "Needs attention")]] as const) {
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
    find(".rp-ring").setAttribute("aria-label", t(`已检查 ${counts.checked} 次：未触发风险 ${counts.clear}，RiskProof 拦截 ${counts.blocked}，需要关注 ${counts.attention}`, `Checked ${counts.checked}: no risk triggered ${counts.clear}, RiskProof blocked ${counts.blocked}, needs attention ${counts.attention}`));

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
    activity.setAttribute("aria-label", t(`最近 ${data.activity.length} 次真实工具检查；颜色与调用分布对应`, `Last ${data.activity.length} real tool checks; colors match the call distribution`));

    find(".rp-risk-count").textContent = data.risks.length ? t(`最近 ${data.risks.length} 条`, `Last ${data.risks.length}`) : "";
    const risks = find(".rp-risks");
    risks.replaceChildren();
    for (const risk of data.risks) {
      const card = element("article", "rp-risk");
      card.dataset.kind = risk.kind;
      const title = element("div", "rp-risk-title");
      title.append(element("span", "", risk.title), element("span", "rp-tag", risk.outcome));
      card.append(title);
      const flow = element("div", "rp-flow");
      flow.setAttribute("aria-label", t("风险来源链", "Risk provenance chain"));
      const nodes = [...risk.sources, risk.tool];
      nodes.forEach((name, i) => {
        if (i) flow.append(element("span", "", "→"));
        const node = element("span", "rp-node", name);
        node.title = name;
        flow.append(node);
      });
      card.append(flow);
      if (risk.remediation) card.append(element("p", "rp-remediation", risk.remediation));
      card.title = risk.rule;
      risks.append(card);
    }
    if (!data.risks.length) {
      const empty = element("div", "rp-empty");
      empty.innerHTML = shield;
      empty.append(element("strong", "", !data.proofEnabled ? t("证据记录已关闭", "Proof recording is disabled") : counts.checked ? t("暂未发现需关注的记录", "No records needing attention yet") : t("等待第一条工具记录", "Waiting for the first tool record")), element("p", "", !data.proofEnabled ? t("启用插件的 proof.enabled 配置后，可查看调用记录。", "Enable proof.enabled in the plugin configuration to view call records.") : t("开始日常任务后，这里会自动更新。", "Start a task; this view updates automatically.")));
      risks.append(empty);
    }

    const health = data.health;
    const healthPanel = find<HTMLElement>(".rp-health");
    healthPanel.hidden = !health;
    find(".rp-health-count").textContent = health ? health.attention
      ? t(`${health.attention} 项需关注`, `${health.attention} need attention`)
      : t("受检配置无缺口", "No gaps in checked settings") : "";
    const checks = find(".rp-checks");
    checks.replaceChildren();
    for (const check of health?.checks ?? []) {
      const row = element("li", "rp-check");
      row.dataset.status = check.status;
      const statusLabel = check.status === "attention" ? t("需关注", "Attention")
        : check.status === "ok" ? t("已配置", "Configured") : t("说明", "Info");
      const heading = element("div", "rp-check-heading");
      heading.append(element("strong", "", check.title), element("span", "rp-check-status", statusLabel));
      row.append(heading, element("p", "", check.detail));
      if (check.action) row.append(element("p", "rp-check-action", check.action));
      checks.append(row);
    }
    find(".rp-health-note").textContent = health?.note ?? "";

    const notices = [!data.proofEnabled ? t("证据记录已关闭，图表不代表实际调用数量。", "Proof recording is disabled; charts do not represent actual call counts.") : "", data.partial ? t("部分检测已关闭，请检查插件配置。", "Some checks are disabled; review the plugin configuration.") : ""].filter(Boolean);
    const notice = find<HTMLElement>(".rp-notice");
    notice.textContent = notices.join(" ");
    notice.hidden = !notices.length;
  }

  return { root, style, panel, beacon, retry, find, render };
}
