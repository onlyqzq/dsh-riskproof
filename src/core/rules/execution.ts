import type { Rule } from "./types.js";
import { hasCapability, credentialArgs, untrustedArgs } from "./context.js";

/** Network-capable shell commands carrying credentials are outbound sinks too. */
export const ruleCredentialNetworkCommand: Rule = (ctx, view) => {
  if (!hasCapability(ctx, "CODE_EXECUTION")) return null;
  const network = ctx.analysis.commandRisks.filter((finding) => finding.kind === "network_egress");
  const credentials = credentialArgs(view);
  if (network.length === 0 || credentials.length === 0) return null;
  const fields = [...new Set([...network.map((finding) => finding.field), ...credentials])];
  return {
    id: "credential_network_command",
    decision: "deny",
    riskLevel: "critical",
    triggeredArgs: fields,
    evidence: [
      ...network.map((finding) => `arg '${finding.field}' contains a network-capable command`),
      ...credentials.map((field) => `arg '${field}' carries SECRET/API_KEY`),
    ],
    reason: "a network-capable command is carrying credential material",
    remediation: "Remove inline credentials and use an approved credential helper with a constrained destination.",
  };
};

/** Catastrophic operations are hard invariants and cannot be relaxed. */
export const ruleCatastrophicOperation: Rule = (ctx) => {
  if (!hasCapability(ctx, "CODE_EXECUTION")) return null;
  const findings = ctx.analysis.commandRisks.filter((finding) => finding.kind === "catastrophic_operation");
  if (findings.length === 0) return null;
  return {
    id: "catastrophic_system_operation",
    decision: "deny",
    riskLevel: "critical",
    triggeredArgs: [...new Set(findings.map((finding) => finding.field))],
    evidence: findings.map((finding) => `arg '${finding.field}' matches ${finding.category}`),
    reason: "command contains a high-confidence irreversible system operation",
    remediation: "Replace the operation with a narrowly scoped, recoverable command and verify its explicit target.",
  };
};

/** Download-and-execute pipelines bypass review of the executed artifact. */
export const ruleRemoteScriptExecution: Rule = (ctx) => {
  if (!hasCapability(ctx, "CODE_EXECUTION")) return null;
  const findings = ctx.analysis.commandRisks.filter((finding) => finding.kind === "remote_script_execution");
  if (findings.length === 0) return null;
  return {
    id: "remote_script_execution",
    decision: ctx.policy.remoteScriptExecution,
    riskLevel: "critical",
    triggeredArgs: [...new Set(findings.map((finding) => finding.field))],
    evidence: findings.map((finding) => `arg '${finding.field}' contains a ${finding.category}`),
    reason: "remote content is piped directly into an interpreter without review",
    remediation: "Download to a file, verify its source and contents, then execute the reviewed artifact separately.",
  };
};

/** Recoverable but destructive commands use the configured approval posture. */
export const ruleDestructiveOperation: Rule = (ctx) => {
  if (!hasCapability(ctx, "CODE_EXECUTION")) return null;
  const findings = ctx.analysis.commandRisks.filter((finding) => finding.kind === "destructive_operation");
  if (findings.length === 0) return null;
  return {
    id: "destructive_operation",
    decision: ctx.policy.destructiveOperation,
    riskLevel: "high",
    triggeredArgs: [...new Set(findings.map((finding) => finding.field))],
    evidence: findings.map((finding) => `arg '${finding.field}' matches ${finding.category}`),
    reason: "command can irreversibly modify local or remote state",
    remediation: "Create a checkpoint or backup and replace forced or recursive flags with the narrowest viable operation.",
  };
};

/** Untrusted content influencing code execution. */
export const ruleUntrustedCodeExecution: Rule = (ctx, view) => {
  if (!hasCapability(ctx, "CODE_EXECUTION")) return null;
  const args = untrustedArgs(view);
  if (args.length === 0) return null;
  return {
    id: "untrusted_code_execution",
    decision: ctx.policy.untrustedCodeExecution,
    riskLevel: "critical",
    triggeredArgs: args,
    evidence: args.map((field) => `arg '${field}' carries untrusted content`),
    reason: "code execution is influenced by untrusted content (possible indirect prompt injection)",
    remediation: "Remove untrusted-derived command text and reconstruct the command from trusted constants.",
  };
};

/** Untrusted content influencing a local write can persist an attack. */
export const ruleUntrustedLocalMutation: Rule = (ctx, view) => {
  if (!hasCapability(ctx, "LOCAL_MUTATION")) return null;
  const args = untrustedArgs(view);
  if (args.length === 0) return null;
  return {
    id: "untrusted_local_mutation",
    decision: ctx.policy.untrustedLocalMutation,
    riskLevel: "high",
    triggeredArgs: args,
    evidence: args.map((field) => `arg '${field}' carries untrusted content into a local mutation`),
    reason: "untrusted content is being persisted to local state",
    remediation: "Review and sanitize the untrusted-derived fields before writing them.",
  };
};

/** Sensitive path reads/writes are gated before file content reaches the model. */
export const ruleSensitivePathAccess: Rule = (ctx) => {
  const reads = hasCapability(ctx, "PRIVATE_ACCESS") || hasCapability(ctx, "CREDENTIAL_ACCESS");
  const mutates = hasCapability(ctx, "LOCAL_MUTATION");
  if (!reads && !mutates) return null;
  const findings = ctx.analysis.sensitivePaths;
  if (findings.length === 0) return null;
  return {
    id: mutates ? "sensitive_path_mutation" : "sensitive_path_read",
    decision: mutates ? ctx.policy.sensitivePathMutation : ctx.policy.sensitivePathRead,
    riskLevel: mutates ? "critical" : "high",
    triggeredArgs: [...new Set(findings.map((finding) => finding.field))],
    evidence: findings.map((finding) => `arg '${finding.field}' references ${finding.category}`),
    reason: mutates
      ? "a local mutation targets a path likely to contain credential material"
      : "a private read targets a path likely to contain credential material",
    remediation: mutates
      ? "Write a template or non-secret configuration file instead of modifying the credential-bearing path."
      : "Use a metadata-only inspection or a credential helper that does not expose the raw value to the model.",
  };
};
