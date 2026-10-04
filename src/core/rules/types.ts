import type { Decision, RiskLevel, TaintLabel, ToolSecurityContext } from "../types.js";
import type { EnginePolicy } from "../policy.js";
import type { CommandRiskFinding } from "../command-risk.js";
import type { SensitivePathFinding } from "../path-policy.js";
import type { NetworkDestination } from "../destination.js";

export interface ArgumentView {
  field: string;
  value: unknown;
  source: string[];
  taints: TaintLabel[];
}

export interface RuleResult {
  id: string;
  decision: Decision;
  riskLevel: RiskLevel;
  triggeredArgs: string[];
  evidence: string[];
  reason: string;
  remediation?: string;
}

export interface ExtendedToolSecurityContext extends ToolSecurityContext {
  policy: EnginePolicy;
  analysis: {
    commandRisks: CommandRiskFinding[];
    sensitivePaths: SensitivePathFinding[];
    destinations: NetworkDestination[];
    externalDestinations: NetworkDestination[];
  };
}

export type Rule = (ctx: ExtendedToolSecurityContext, view: Record<string, ArgumentView>) => RuleResult | null;
