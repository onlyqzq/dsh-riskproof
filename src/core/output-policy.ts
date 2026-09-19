// ============================================================================
// dsh-riskproof — output-side information-flow control
// ============================================================================
// Pure policy over labels only. The DSH adapter extracts labels from the
// model-facing result projections and applies the returned block decision.
// Trusted declassification is deliberately narrow: an operator-pinned tool
// may remove configured labels inherited from its inputs, but labels inferred
// from the tool itself or detected in its actual output are always restored.
// ============================================================================

import type { TaintLabel } from "./types.js";

export interface OutputPolicy {
  enabled: boolean;
  blockedTaints: TaintLabel[];
  trustedDeclassifiers: Record<string, TaintLabel[]>;
}

export interface OutputFlowDecision {
  action: "allow" | "block";
  taints: TaintLabel[];
  declassifiedTaints: TaintLabel[];
  blockedTaints: TaintLabel[];
}

/** Evaluate output labels without seeing or retaining the underlying value. */
export function evaluateOutputFlow(
  toolName: string,
  inheritedTaints: readonly TaintLabel[],
  sourceTaints: readonly TaintLabel[],
  detectedTaints: readonly TaintLabel[],
  policy: OutputPolicy,
): OutputFlowDecision {
  const allowed = new Set(policy.enabled ? policy.trustedDeclassifiers[toolName] ?? [] : []);
  const inherited = new Set(inheritedTaints);
  const declassifiedTaints = [...inherited].filter((taint) => allowed.has(taint));
  const taints = new Set<TaintLabel>();

  for (const taint of inherited) {
    if (!allowed.has(taint)) taints.add(taint);
  }
  // A declassifier cannot erase labels supported by its declared source class
  // or by deterministic inspection of what it actually returned.
  for (const taint of sourceTaints) taints.add(taint);
  for (const taint of detectedTaints) taints.add(taint);

  const blocked = policy.enabled
    ? policy.blockedTaints.filter((taint) => taints.has(taint))
    : [];
  return {
    action: blocked.length > 0 ? "block" : "allow",
    taints: [...taints],
    declassifiedTaints,
    blockedTaints: blocked,
  };
}
