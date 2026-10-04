import type { Decision } from "./types.js";

/** Operator-configurable policy and the default enforcement posture. */
export interface EnginePolicy {
  sensitiveExternalAction: Decision;
  untrustedPrivateAccess: Decision;
  untrustedCodeExecution: Decision;
  untrustedLocalMutation: Decision;
  credentialAccessAfterUntrusted: Decision;
  sensitivePathRead: Decision;
  sensitivePathMutation: Decision;
  destructiveOperation: Decision;
  remoteScriptExecution: Decision;
  unlistedExternalAction: Decision;
  unknownTool: Decision;
  internalDomains: string[];
  blockedDomains: string[];
  allowedExternalDomains: string[];
  sensitivePathPatterns: string[];
}

export const DEFAULT_POLICY: EnginePolicy = Object.freeze({
  sensitiveExternalAction: "deny",
  untrustedPrivateAccess: "require_approval",
  untrustedCodeExecution: "deny",
  untrustedLocalMutation: "require_approval",
  credentialAccessAfterUntrusted: "deny",
  sensitivePathRead: "require_approval",
  sensitivePathMutation: "deny",
  destructiveOperation: "require_approval",
  remoteScriptExecution: "deny",
  unlistedExternalAction: "require_approval",
  unknownTool: "require_approval",
  internalDomains: [],
  blockedDomains: [],
  allowedExternalDomains: [],
  sensitivePathPatterns: [],
});
