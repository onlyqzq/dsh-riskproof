import type { ReportSnapshot } from "./report.js";
import { displayText, RULE_GUIDANCE } from "./report.js";

/** Deliberately small wire contract: no arguments, result bodies, raw evidence or paths. */
export interface Dashboard {
  sessionId: string | null;
  mode: "enforce" | "observe";
  taskMode: string;
  proofEnabled: boolean;
  partial: boolean;
  limit: number;
  counts: { checked: number; clear: number; blocked: number; attention: number; succeeded: number; pending: number };
  latestAt: string | null;
  activity: Array<{ id: string; kind: "clear" | "blocked" | "attention"; tool: string; at: string }>;
  risks: Array<{ id: string; tool: string; sources: string[]; title: string; rule: string; outcome: string; kind: "blocked" | "attention" }>;
}

export function dashboard(snapshot: ReportSnapshot, sessionId: string | null): Dashboard {
  const kind = (p: ReportSnapshot["proofs"][number]): "clear" | "blocked" | "attention" =>
    p.mode === "enforce" && p.decision === "deny" && p.receipt?.gate === "deny" ? "blocked"
      : p.decision !== "allow" || p.receipt?.gate === "deny" || p.receipt?.outcome === "error" ? "attention" : "clear";
  const proofs = sessionId === null ? [] : snapshot.proofs;
  const risks = proofs.filter(p => kind(p) !== "clear");
  return {
    sessionId, mode: snapshot.mode, taskMode: snapshot.taskMode,
    proofEnabled: snapshot.proofEnabled,
    partial: !snapshot.provenanceEnabled || !snapshot.taintEnabled || !snapshot.toolchainEnabled,
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
      title: RULE_GUIDANCE[p.matchedRules[0]?.id]?.[0] ?? "操作需要关注",
      rule: displayText(p.matchedRules[0]?.id ?? ""),
      outcome: p.mode === "observe" ? "仅观察，未主动拦截"
        : kind(p) === "blocked" ? "已阻止执行"
          : p.receipt?.outcome === "error" ? "工具执行出错"
            : p.receipt?.gate === "deny" ? "被其他规则阻止"
              : p.receipt?.outcome === "succeeded" ? "已执行，存在风险"
                : p.receipt?.gate === "ask" ? "已请求确认" : "等待执行回执",
      kind: kind(p) === "blocked" ? "blocked" : "attention",
    })),
  };
}
