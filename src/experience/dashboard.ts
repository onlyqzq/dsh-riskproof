import { protectionHealth, type ProtectionHealth } from "./health.js";
import type { ReportSnapshot } from "./report.js";
import { displayText, RULE_GUIDANCE } from "./report.js";

const ENGLISH_GUIDANCE: Record<string, [string, string]> = {
  untrusted_code_execution: ["External content influenced command execution", "Verify the command source and use reviewed command content."],
  sensitive_data_external_action: ["Sensitive data is about to leave", "Remove or redact sensitive fields, or use a configured internal destination."],
  private_data_exfiltration_chain: ["External content → private read → data transfer", "Stop this tool chain and verify the external instructions and recipient."],
  credential_external_action: ["Credentials are about to leave", "Remove credentials from outgoing content."],
  credential_network_command: ["Network command contains credentials", "Remove credentials from the command and use a controlled authentication method."],
  tool_identity_changed: ["Tool metadata changed", "Review the provider and schema changes; start a new session only after verification."],
  task_scope_violation: ["Action exceeds task scope", "Use tools within scope. Only the operator can change scope with /riskproof task."],
  sensitive_tool_output: ["Sensitive tool output blocked", "Remove sensitive values at the source or use an operator-approved declassifier."],
  unknown_tool: ["Tool capabilities are unknown", "Inspect the tool and declare its capabilities in classification.overrides."],
  sensitive_path_read: ["Reading a sensitive path", "Confirm that access to this credential or configuration file is needed."],
  sensitive_path_mutation: ["Modifying a sensitive path", "Review the target path to avoid overwriting credentials or security settings."],
  remote_script_execution: ["Downloaded content executed directly", "Download and review the script before deciding whether to execute it."],
  destructive_operation: ["Potentially irreversible changes", "Verify the target and backup; prefer recoverable operations."],
};

/** Deliberately small wire contract: no arguments, result bodies, raw evidence or paths. */
export interface Dashboard {
  sessionId: string | null;
  /** Optional for clients connected to an older plugin snapshot. */
  language?: "zh-CN" | "en";
  health?: ProtectionHealth;
  mode: "enforce" | "observe";
  taskMode: string;
  proofEnabled: boolean;
  partial: boolean;
  limit: number;
  counts: { checked: number; clear: number; blocked: number; attention: number; succeeded: number; pending: number };
  latestAt: string | null;
  activity: Array<{ id: string; kind: "clear" | "blocked" | "attention"; tool: string; at: string }>;
  risks: Array<{ id: string; tool: string; sources: string[]; title: string; rule: string; outcome: string; remediation?: string; kind: "blocked" | "attention" }>;
}

export function dashboard(snapshot: ReportSnapshot, sessionId: string | null): Dashboard {
  const zh = snapshot.language !== "en";
  const t = (cn: string, en: string) => zh ? cn : en;
  const title = (id: string) => zh ? RULE_GUIDANCE[id]?.[0] ?? "操作需要关注"
    : ENGLISH_GUIDANCE[id]?.[0] ?? "Action needs attention";
  const remediation = (id: string) => (zh ? RULE_GUIDANCE : ENGLISH_GUIDANCE)[id]?.[1]
    ?? t("通过 /riskproof trace 核对规则与回执，再检查工具和配置。", "Use /riskproof trace to review the rule and receipt, then inspect the tool and configuration.");
  const kind = (p: ReportSnapshot["proofs"][number]): "clear" | "blocked" | "attention" =>
    p.mode === "enforce" && (p.decision === "deny" && p.receipt?.gate === "deny" || p.receipt?.output?.action === "block") ? "blocked"
      : p.decision !== "allow" || p.receipt?.gate === "deny" || p.receipt?.outcome === "error" || p.receipt?.output?.action === "would_block" ? "attention" : "clear";
  const proofs = sessionId === null ? [] : snapshot.proofs;
  const risks = proofs.filter(p => kind(p) !== "clear");
  return {
    health: protectionHealth({ ...snapshot, proofs }),
    sessionId, language: snapshot.language, mode: snapshot.mode, taskMode: snapshot.taskMode,
    proofEnabled: snapshot.proofEnabled,
    partial: !snapshot.provenanceEnabled || !snapshot.taintEnabled || !snapshot.toolchainEnabled || !snapshot.outputEnabled,
    limit: snapshot.limit,
    counts: {
      checked: proofs.length,
      clear: proofs.filter(p => kind(p) === "clear").length,
      blocked: proofs.filter(p => kind(p) === "blocked").length,
      attention: proofs.filter(p => kind(p) === "attention").length,
      succeeded: proofs.filter(p => p.receipt?.outcome === "succeeded").length,
      pending: proofs.filter(p => p.receipt?.outcome === "pending" && p.receipt.gate !== "deny").length,
    },
    latestAt: proofs.at(-1)?.timestamp ?? null,
    activity: proofs.slice(-24).map(p => ({ id: p.proofId, kind: kind(p), tool: displayText(p.tool), at: p.timestamp })),
    risks: risks.slice(-3).reverse().map(p => ({
      id: p.proofId, tool: displayText(p.tool),
      sources: [...new Set((p.sources ?? []).map(s => displayText(s.tool)))].slice(0, 3),
      title: title(p.receipt?.output?.action === "block" ? "sensitive_tool_output" : p.matchedRules[0]?.id ?? ""),
      rule: displayText(p.receipt?.output?.action === "block" ? "sensitive_tool_output" : p.matchedRules[0]?.id ?? ""),
      remediation: remediation(p.receipt?.output?.action === "block" || p.receipt?.output?.action === "would_block" ? "sensitive_tool_output" : p.matchedRules[0]?.id ?? ""),
      outcome: p.mode === "observe" ? t("仅观察，未主动拦截", "Observe only; no RiskProof block")
        : p.receipt?.output?.action === "block" ? t("已拦截工具输出", "Tool output blocked")
        : kind(p) === "blocked" ? t("已阻止执行", "Execution prevented")
          : p.receipt?.outcome === "error" ? t("工具执行出错", "Tool execution failed")
            : p.receipt?.gate === "deny" ? t("被其他规则阻止", "Blocked by another guard")
              : p.receipt?.outcome === "succeeded" ? t("已执行，存在风险", "Executed with risk")
                : p.receipt?.gate === "ask" ? t("已请求确认", "Approval requested") : t("等待执行回执", "Awaiting execution receipt"),
      kind: kind(p) === "blocked" ? "blocked" : "attention",
    })),
  };
}
