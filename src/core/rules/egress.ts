import type { Rule } from "./types.js";
import { extractHosts, isCloudMetadataOrLinkLocalHost, matchesDomainPattern } from "../destination.js";
import { hasCapability, SINK_FIELD_ALIASES, normalizeFieldName, credentialArgs, sensitiveArgs } from "./context.js";

/** Hard invariant: cloud metadata and link-local hosts are never reachable. */
export const ruleCloudMetadataLinkLocal: Rule = (ctx, view) => {
  if (!hasCapability(ctx, "EXTERNAL_ACTION")) return null;
  const restricted: string[] = [];
  for (const [name, argument] of Object.entries(view)) {
    if (!SINK_FIELD_ALIASES.has(normalizeFieldName(argument.field))) continue;
    for (const host of extractHosts(argument.value)) {
      if (isCloudMetadataOrLinkLocalHost(host)) {
        restricted.push(name);
        break;
      }
    }
  }
  if (restricted.length === 0) return null;
  return {
    id: "cloud_metadata_link_local",
    decision: "deny",
    riskLevel: "critical",
    triggeredArgs: restricted,
    evidence: restricted.map((field) => `arg '${field}' targets a cloud metadata or link-local address`),
    reason: "external action targets a cloud metadata or link-local address, which can leak instance credentials",
    remediation: "Use an approved service endpoint instead of a metadata or link-local address.",
  };
};

/** Operator denylist: applies even when no sensitive data is present. */
export const ruleBlockedDestination: Rule = (ctx) => {
  if (!hasCapability(ctx, "EXTERNAL_ACTION") || ctx.policy.blockedDomains.length === 0) return null;
  const blocked = ctx.analysis.destinations.filter((destination) =>
    ctx.policy.blockedDomains.some((pattern) => matchesDomainPattern(destination.target, pattern)));
  if (blocked.length === 0) return null;
  const targets = [...new Set(blocked.map((destination) => destination.target))];
  return {
    id: "blocked_destination",
    decision: "deny",
    riskLevel: "critical",
    triggeredArgs: [...new Set(blocked.map((destination) => destination.field))],
    evidence: [`destination matches policy.blockedDomains: ${targets.join(", ")}`],
    reason: `external action targets an operator-blocked destination (${targets.join(", ")})`,
    remediation: "Choose an approved destination or review the blockedDomains entry outside the agent session.",
  };
};

/** Optional egress allowlist: only active when at least one domain is listed. */
export const ruleUnlistedExternalDestination: Rule = (ctx) => {
  if (!hasCapability(ctx, "EXTERNAL_ACTION") || ctx.policy.allowedExternalDomains.length === 0) return null;
  const unlisted = ctx.analysis.externalDestinations.filter((destination) =>
    !ctx.policy.allowedExternalDomains.some((pattern) => matchesDomainPattern(destination.target, pattern)));
  if (unlisted.length === 0) return null;
  const targets = [...new Set(unlisted.map((destination) => destination.target))];
  return {
    id: "unlisted_external_destination",
    decision: ctx.policy.unlistedExternalAction,
    riskLevel: "high",
    triggeredArgs: [...new Set(unlisted.map((destination) => destination.field))],
    evidence: [`external destination is not allowlisted: ${targets.join(", ")}`],
    reason: `external action targets a destination outside policy.allowedExternalDomains (${targets.join(", ")})`,
    remediation: "Use an allowlisted destination or have an operator add the domain after verification.",
  };
};

/** Credentials flowing to an external action. */
export const ruleCredentialExternalAction: Rule = (ctx, view) => {
  if (!hasCapability(ctx, "EXTERNAL_ACTION")) return null;
  const args = credentialArgs(view);
  if (args.length === 0) return null;
  return {
    id: "credential_external_action",
    decision: "deny",
    riskLevel: "critical",
    triggeredArgs: args,
    evidence: args.map((field) => `arg '${field}' carries SECRET/API_KEY`),
    reason: "credential material is being sent to an external action",
    remediation: "Remove the credential value and pass a vault reference or server-side credential binding instead.",
  };
};

/** Sensitive data flowing to a confirmed external destination. */
export const ruleSensitiveExternalAction: Rule = (ctx, view) => {
  if (!hasCapability(ctx, "EXTERNAL_ACTION")) return null;
  const destinations = ctx.analysis.externalDestinations;
  if (destinations.length === 0) return null;
  const sensitive = sensitiveArgs(view);
  if (sensitive.length === 0) return null;
  const targets = [...new Set(destinations.map((d) => d.target))];
  return {
    id: "sensitive_data_external_action",
    decision: ctx.policy.sensitiveExternalAction,
    riskLevel: "critical",
    triggeredArgs: [...new Set([...sensitive, ...destinations.map((d) => d.field)])],
    evidence: [
      ...sensitive.map((field) => `arg '${field}' carries sensitive data`),
      `external destination(s): ${targets.join(", ")}`,
    ],
    reason: `sensitive data is being sent to an external destination (${targets.join(", ")})`,
    remediation: "Remove or redact sensitive fields, or route the action to a configured internal domain.",
  };
};
