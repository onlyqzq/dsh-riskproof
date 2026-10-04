import type { Rule } from "./types.js";
import { hasCapability, sawOrderedIngestionThenPrivateAccess, sensitiveArgs } from "./context.js";

/** Credential reads after external ingestion are a common prompt-injection step. */
export const ruleCredentialAccessAfterUntrusted: Rule = (ctx) => {
  if (!hasCapability(ctx, "CREDENTIAL_ACCESS") || !ctx.toolchain.sawIngestion) return null;
  return {
    id: "credential_access_after_untrusted",
    decision: ctx.policy.credentialAccessAfterUntrusted,
    riskLevel: "critical",
    triggeredArgs: [],
    evidence: ["observed capability transition: external_ingestion -> credential_access"],
    reason: "credential access follows untrusted external ingestion",
    remediation: "Start a clean task without untrusted context or obtain the credential through a non-model server-side binding.",
  };
};

/** Full EIT → PAT → NAT chain with sensitive data actually in the outbound args. */
export const rulePrivateDataExfiltrationChain: Rule = (ctx, view) => {
  if (!hasCapability(ctx, "EXTERNAL_ACTION")) return null;
  const state = ctx.toolchain;
  if (!sawOrderedIngestionThenPrivateAccess(ctx)) return null;
  const sensitive = sensitiveArgs(view);
  if (sensitive.length === 0) return null;
  return {
    id: "private_data_exfiltration_chain",
    decision: "deny",
    riskLevel: "critical",
    triggeredArgs: sensitive,
    evidence: [
      `observed capability path: ${state.path.join(" -> ")} -> external_action`,
      `outbound argument(s) carry private evidence: ${sensitive.join(", ")}`,
    ],
    reason: "external ingestion, private access, and outbound sensitive data form a complete exfiltration chain",
    remediation: "Remove the private-derived fields and restart from a trusted context before any external action.",
  };
};

/** EIT → PAT → NAT chain without confirmed sensitive data in the outbound args. */
export const ruleSuspiciousDisclosureChain: Rule = (ctx) => {
  if (!hasCapability(ctx, "EXTERNAL_ACTION")) return null;
  const state = ctx.toolchain;
  if (!sawOrderedIngestionThenPrivateAccess(ctx)) return null;
  return {
    id: "suspicious_disclosure_chain",
    decision: "require_approval",
    riskLevel: "high",
    triggeredArgs: [],
    evidence: [`observed capability path: ${state.path.join(" -> ")} -> external_action`],
    reason: "external action follows external ingestion and private access, forming a potential exfiltration chain",
    remediation: "Review the outbound payload and destination, or restart the action in a clean trusted task.",
  };
};

/** Private access immediately after untrusted ingestion. */
export const ruleUntrustedPrivateAccess: Rule = (ctx) => {
  if (!hasCapability(ctx, "PRIVATE_ACCESS")) return null;
  if (!ctx.toolchain.sawIngestion) return null;
  return {
    id: "untrusted_private_access",
    decision: ctx.policy.untrustedPrivateAccess,
    riskLevel: "high",
    triggeredArgs: [],
    evidence: [`observed capability transition: external_ingestion -> private_access`],
    reason: "private data access follows untrusted external ingestion",
    remediation: "Confirm the access is user-requested or perform it in a clean task without untrusted context.",
  };
};
