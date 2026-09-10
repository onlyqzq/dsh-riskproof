import type { RiskProofRuntime } from "../dsh/runtime.js";
import type { SecurityProof } from "../core/types.js";
import { redactLogText } from "../proof/redaction.js";

export type ReportSnapshot = ReturnType<RiskProofRuntime["report"]>;

export const RULE_GUIDANCE: Record<string, [string, string]> = {
  untrusted_code_execution: ["网页／外部内容影响了命令执行", "先核对命令来源，使用经过确认的命令内容。"],
  sensitive_data_external_action: ["敏感数据即将外发", "删除或脱敏敏感字段，或改用已配置的内部目的地。"],
  private_data_exfiltration_chain: ["外部内容 → 私密读取 → 数据外发", "停止这条工具链，核对外部指令和接收方，再决定是否继续。"],
  credential_external_action: ["凭据即将外发", "从外发内容中移除密钥、令牌等凭据。"],
  credential_network_command: ["网络命令携带凭据", "移除命令中的凭据，改用受控的认证方式。"],
  tool_identity_changed: ["工具身份发生变化", "核对工具提供方及 schema 变化；确认后通过新会话建立基线。"],
  task_scope_violation: ["操作超出本次任务范围", "改用范围内的工具；如需扩大范围，由你通过 /riskproof task 调整。"],
  unknown_tool: ["无法确定工具能力", "检查工具后，在 classification.overrides 中明确它的能力。"],
  sensitive_path_read: ["正在读取敏感路径", "确认是否确实需要读取该凭据或配置文件。"],
  sensitive_path_mutation: ["正在修改敏感路径", "检查目标路径，避免覆盖凭据或安全配置。"],
  remote_script_execution: ["下载内容后直接执行", "先下载并审查脚本，再决定是否执行。"],
  destructive_operation: ["可能造成不可逆修改", "确认目标和备份，优先使用可恢复的操作。"],
};

/** Plain text is shared by native DSH command cards and tool-result cards. */
export function renderReport(snapshot: ReportSnapshot, view: "status" | "trace" = "status"): string {
  const zh = snapshot.language === "zh-CN";
  const t = (cn: string, en: string) => zh ? cn : en;
  const proofs = snapshot.proofs;
  const blocked = proofs.filter((p) => p.mode === "enforce" && p.decision === "deny" && p.receipt?.gate === "deny").length;
  const asked = proofs.filter((p) => p.mode === "enforce" && p.decision === "require_approval" && p.receipt?.gate === "ask").length;
  const observed = proofs.filter((p) => p.mode === "observe" && p.decision !== "allow").length;
  const succeeded = proofs.filter((p) => p.receipt?.outcome === "succeeded").length;
  const lines = [
    t("🛡 RiskProof · 会话安全账单", "🛡 RiskProof · Session security receipt"),
    snapshot.mode === "enforce" ? t("执行防护已启用", "Execution protection enabled") : t("观察模式 · 仅记录建议，不执行 RiskProof 拦截", "Observe mode · recommendations only; RiskProof does not block"),
    `${t("策略", "Policy")}: ${snapshot.preset}  ·  ${t("任务范围", "Task scope")}: ${snapshot.taskMode}`,
    "",
    `${t("已检查", "Checked")} ${proofs.length}  ·  ${t("RiskProof 已拦截", "Blocked by RiskProof")} ${blocked}  ·  ${t("已请求确认", "Approval requested")} ${asked}`,
    `${t("成功回执", "Successful receipts")} ${succeeded}  ·  ${t("仅观察到风险", "Observed risks")} ${observed}`,
    t(`统计仅包含当前会话在本次插件运行中仍保留的记录（全局上限 ${snapshot.limit} 条）。`,
      `Counts cover this session's retained records in this plugin run (global limit ${snapshot.limit}).`),
  ];
  if (!snapshot.proofEnabled) lines.push(t("⚠ 证据记录已关闭；零条记录不代表没有工具调用。", "⚠ Proof recording is disabled; zero records does not mean no tool calls."));
  if (!snapshot.provenanceEnabled || !snapshot.taintEnabled || !snapshot.toolchainEnabled) {
    lines.push(t("⚠ 部分检测已关闭，请检查 provenance / taint / toolchain 配置。", "⚠ Some detection features are disabled; check provenance / taint / toolchain configuration."));
  }
  if (!proofs.length) lines.push("", t("还没有安全记录。先运行 /riskproof demo 体验溯源拦截，再开始日常任务。", "No security records yet. Try /riskproof demo to see a provenance interception, then start your task."));
  const recent = view === "trace" ? proofs.slice(-10) : proofs.filter((p) => p.decision !== "allow").slice(-3);
  for (const proof of recent) lines.push("", ...renderProof(proof, zh));
  lines.push("", t("入口: /riskproof trace · /riskproof demo · /riskproof task read-only · /riskproof help",
    "Commands: /riskproof trace · /riskproof demo · /riskproof task read-only · /riskproof help"));
  lines.push(t("证据不包含参数或结果正文。展示内容会进入 DSH 命令／工具日志。", "Evidence excludes argument and result bodies. Displayed reports enter DSH command/tool logs."));
  return lines.join("\n");
}

/** Escape untrusted metadata so it cannot forge Markdown, HTML, or terminal controls. */
export function displayText(value: string): string {
  return redactLogText(value).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/[<>&`*\[\]|]/g, " ").slice(0, 240);
}

function renderProof(proof: SecurityProof, zh: boolean): string[] {
  const verdict = proof.mode === "observe"
    ? (zh ? `仅建议 ${proof.decision}` : `Recommendation: ${proof.decision}`)
    : proof.decision === "deny" ? (zh ? "策略拒绝" : "Policy deny")
      : proof.decision === "require_approval" ? (zh ? "需要确认" : "Approval required")
        : (zh ? "策略允许" : "Policy allow");
  const sources = [...new Set((proof.sources ?? []).map((source) => displayText(source.tool)))];
  const taints = [...new Set(Object.values(proof.taintSummary).flat())];
  const lines = [
    `${verdict} · ${displayText(proof.tool)} · ${proof.riskLevel}`,
    `${zh ? "来源" : "Sources"}: ${sources.length ? `${sources.join(" + ")} → ` : ""}${displayText(proof.tool)}${sources.length ? "" : (zh ? "（无可匹配来源）" : " (no matched source)")}`,
    `${zh ? "标签" : "Labels"}: ${taints.join(", ") || "—"}`,
    `${zh ? "规则" : "Rules"}: ${proof.matchedRules.map((r) => zh && RULE_GUIDANCE[r.id]
      ? `${RULE_GUIDANCE[r.id][0]} (${r.id})` : displayText(r.id)).join(", ") || "—"}`,
    `${zh ? "执行回执" : "Receipt"}: ${proof.receipt?.gate ?? "unknown"} → ${proof.receipt?.outcome ?? "pending"}`,
  ];
  if (proof.identity?.status === "changed") lines.push(zh ? "工具身份：描述或 schema 已改变" : "Tool identity: description or schema changed");
  const translated = zh ? proof.matchedRules.flatMap((rule) => RULE_GUIDANCE[rule.id] ? [RULE_GUIDANCE[rule.id][1]] : []) : [];
  for (const action of (translated.length ? [...new Set(translated)] : proof.remediations).slice(0, 2)) {
    lines.push(`${zh ? "建议" : "Next"}: ${displayText(action)}`);
  }
  return lines;
}
