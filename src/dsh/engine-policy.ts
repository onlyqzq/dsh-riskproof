import type { RiskProofConfig } from "../config.js";
import type { EnginePolicy } from "../core/policy.js";
import { configDecisionToInternal } from "./decisions.js";

/** Translate deployment decisions into core policy vocabulary. */
export function buildEnginePolicy(config: RiskProofConfig["policy"]): EnginePolicy {
  return {
    sensitiveExternalAction: configDecisionToInternal(config.sensitiveExternalAction),
    untrustedPrivateAccess: configDecisionToInternal(config.untrustedPrivateAccess),
    untrustedCodeExecution: configDecisionToInternal(config.untrustedCodeExecution),
    untrustedLocalMutation: configDecisionToInternal(config.untrustedLocalMutation),
    credentialAccessAfterUntrusted: configDecisionToInternal(config.credentialAccessAfterUntrusted),
    sensitivePathRead: configDecisionToInternal(config.sensitivePathRead),
    sensitivePathMutation: configDecisionToInternal(config.sensitivePathMutation),
    destructiveOperation: configDecisionToInternal(config.destructiveOperation),
    remoteScriptExecution: configDecisionToInternal(config.remoteScriptExecution),
    unlistedExternalAction: configDecisionToInternal(config.unlistedExternalAction),
    unknownTool: configDecisionToInternal(config.unknownTool),
    internalDomains: [...config.internalDomains],
    blockedDomains: [...config.blockedDomains],
    allowedExternalDomains: [...config.allowedExternalDomains],
    sensitivePathPatterns: [...config.sensitivePathPatterns],
  };
}

