import type { SecurityCapability } from "../types.js";
import type { Rule } from "./types.js";

/** Pin tool identity to the session baseline. */
export const ruleToolIdentity: Rule = (ctx) => ctx.identityStatus === "changed" || ctx.identityStatus === "capacity-exceeded" ? {
  id: "tool_identity_changed",
  decision: "deny",
  riskLevel: "high",
  triggeredArgs: [],
  evidence: ["Tool metadata no longer matches its session baseline, or the identity table is full."],
  reason: "tool identity continuity could not be verified",
  remediation: "Review the tool provider and schema changes, then start a new session to establish a new baseline.",
} : null;

/** Enforce the task contract selected by the operator. */
export const ruleTaskScope: Rule = (ctx) => {
  const forbidden: SecurityCapability[] = ctx.taskMode === "read-only"
    ? ["LOCAL_MUTATION", "EXTERNAL_ACTION", "CODE_EXECUTION"]
    : ctx.taskMode === "local-only"
      ? ["EXTERNAL_INGESTION", "EXTERNAL_ACTION", "CODE_EXECUTION"] : [];
  // Unknown tools cannot prove that they respect a restricted task contract.
  if (!forbidden.length || (ctx.tool.capabilities.length &&
    !ctx.tool.capabilities.some((capability) => forbidden.includes(capability))))
    return null;
  return {
    id: "task_scope_violation",
    decision: "deny",
    riskLevel: "high",
    triggeredArgs: [],
    evidence: [`Task contract: ${ctx.taskMode}`],
    reason: "tool capabilities exceed the operator-selected task scope",
    remediation: "Use a tool within the selected task scope. Only the operator can change the task contract with /riskproof task.",
  };
};

/** Fail-closed posture for tools the classifier could not place. */
export const ruleUnknownTool: Rule = (ctx) => {
  if (ctx.tool.capabilities.length > 0) return null;
  return {
    id: "unknown_tool",
    decision: ctx.policy.unknownTool,
    riskLevel: "medium",
    triggeredArgs: [],
    evidence: [`tool '${ctx.tool.name}' has no classified security capability`],
    reason: `tool '${ctx.tool.name}' could not be classified into a security capability`,
    remediation: "Add an explicit classification.overrides entry for this tool after reviewing its behavior.",
  };
};
