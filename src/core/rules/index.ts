import type { Rule } from "./types.js";
import { ruleToolIdentity, ruleTaskScope, ruleUnknownTool } from "./invariants.js";
import {
  ruleCloudMetadataLinkLocal,
  ruleBlockedDestination,
  ruleUnlistedExternalDestination,
  ruleCredentialExternalAction,
  ruleSensitiveExternalAction,
} from "./egress.js";
import {
  ruleCredentialNetworkCommand,
  ruleCatastrophicOperation,
  ruleRemoteScriptExecution,
  ruleDestructiveOperation,
  ruleUntrustedCodeExecution,
  ruleUntrustedLocalMutation,
  ruleSensitivePathAccess,
} from "./execution.js";
import {
  ruleCredentialAccessAfterUntrusted,
  rulePrivateDataExfiltrationChain,
  ruleSuspiciousDisclosureChain,
  ruleUntrustedPrivateAccess,
} from "./provenance.js";

/** Evaluation order is observable in receipts, reasons, and the first UI rule. */
export const RULES: readonly Rule[] = [
  ruleToolIdentity,
  ruleTaskScope,
  ruleCloudMetadataLinkLocal,
  ruleBlockedDestination,
  ruleCatastrophicOperation,
  ruleCredentialExternalAction,
  ruleCredentialNetworkCommand,
  ruleCredentialAccessAfterUntrusted,
  ruleSensitiveExternalAction,
  ruleSensitivePathAccess,
  ruleRemoteScriptExecution,
  ruleUntrustedCodeExecution,
  ruleUntrustedLocalMutation,
  ruleDestructiveOperation,
  rulePrivateDataExfiltrationChain,
  ruleSuspiciousDisclosureChain,
  ruleUntrustedPrivateAccess,
  ruleUnlistedExternalDestination,
  ruleUnknownTool,
];
