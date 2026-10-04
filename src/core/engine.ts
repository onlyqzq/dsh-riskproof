// ============================================================================
// dsh-riskproof — deterministic risk engine
// ============================================================================
// Pure, deterministic policy evaluation over a ToolSecurityContext. No IO, no
// LLM, no DSH imports. The DSH adapter translates tool executions into the
// context, and translates the returned decision back into allow/ask/deny.
//
// Rule evaluation is priority-ordered (hard invariants first) and aggregated
// with a strictest-decision / highest-risk monotonic fold, so additional
// findings can only ever tighten the outcome.
// ============================================================================

import type { Decision, MatchedRule, RiskLevel, SecurityDecision, TaintLabel, ToolSecurityContext } from "./types.js";
import { higherRisk, stricterDecision } from "./types.js";
import { findDestinations, isExternalDomain } from "./destination.js";
import { analyzeCommandRisks } from "./command-risk.js";
import { findSensitivePaths } from "./path-policy.js";
import { DEFAULT_POLICY, type EnginePolicy } from "./policy.js";
import { buildView } from "./rules/context.js";
import { RULES } from "./rules/index.js";
import type { ExtendedToolSecurityContext, RuleResult } from "./rules/types.js";

// Preserve the existing import surface for consumers of the engine module.
export { DEFAULT_POLICY, type EnginePolicy } from "./policy.js";
export { SENSITIVE_TAINTS, UNTRUSTED_TAINTS } from "./types.js";

export function evaluate(
  context: ToolSecurityContext,
  policy: EnginePolicy = DEFAULT_POLICY,
  referenceTime?: string,
): SecurityDecision {
  const view = buildView(context);
  const hasCodeExecution = context.tool.capabilities.includes("CODE_EXECUTION");
  const hasPathAccess = context.tool.capabilities.some((capability) =>
    capability === "PRIVATE_ACCESS" || capability === "CREDENTIAL_ACCESS" || capability === "LOCAL_MUTATION");
  const hasExternalAction = context.tool.capabilities.includes("EXTERNAL_ACTION");
  const destinations = hasExternalAction ? findDestinations(context.args) : [];
  const ctx: ExtendedToolSecurityContext = {
    ...context,
    policy,
    analysis: {
      commandRisks: hasCodeExecution ? analyzeCommandRisks(context.args) : [],
      sensitivePaths: hasPathAccess ? findSensitivePaths(context.args, policy.sensitivePathPatterns) : [],
      destinations,
      externalDestinations: destinations.filter((destination) =>
        isExternalDomain(destination.target, context.internalDomains ?? policy.internalDomains)),
    },
  };
  const results: RuleResult[] = [];

  for (const rule of RULES) {
    const result = rule(ctx, view);
    if (result) results.push(result);
  }

  let decision: Decision = "allow";
  let riskLevel: RiskLevel = "low";
  for (const result of results) {
    decision = stricterDecision(decision, result.decision);
    riskLevel = higherRisk(riskLevel, result.riskLevel);
  }

  const matchedRules: MatchedRule[] = results.map((result) => ({
    id: result.id,
    triggeredArgs: [...result.triggeredArgs],
    evidence: [...result.evidence],
    reason: result.reason,
    remediation: result.remediation,
  }));

  const evidence = matchedRules.flatMap((rule) => rule.evidence);
  const reasons = matchedRules.map((rule) => rule.reason).filter(Boolean);
  const remediations = [...new Set(matchedRules
    .map((rule) => rule.remediation)
    .filter((value): value is string => typeof value === "string" && value.length > 0))];
  const reason = reasons.length > 0
    ? reasons.join("; ")
    : "no security policy matched; execution allowed";

  return {
    decision,
    riskLevel,
    matchedRules,
    reason,
    evidence,
    remediations,
    provenance: copyStringMap(context.provenance),
    taints: copyTaintMap(context.taints),
    toolchain: { ...context.toolchain, path: [...context.toolchain.path] },
    timestamp: referenceTime ?? new Date().toISOString(),
  };
}

function copyStringMap(map: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(map).map(([key, value]) => [key, [...value]]));
}

function copyTaintMap(map: Record<string, TaintLabel[]>): Record<string, TaintLabel[]> {
  return Object.fromEntries(Object.entries(map).map(([key, value]) => [key, [...value]]));
}
