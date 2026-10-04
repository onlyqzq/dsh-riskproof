import type { SecurityCapability, TaintLabel, ToolSecurityContext } from "../types.js";
import { SENSITIVE_TAINTS, UNTRUSTED_TAINTS } from "../types.js";
import { argumentLeaves } from "../arguments.js";
import type { ArgumentView } from "./types.js";

const SENSITIVE_TAINTS_SET = new Set<string>(SENSITIVE_TAINTS);
const UNTRUSTED_TAINTS_SET = new Set<string>(UNTRUSTED_TAINTS);

/** Recognized sink fields (email recipient / URL target) excluded from the
 *  sensitive-argument scan so a recipient address is not mistaken for data. */
export const SINK_FIELD_ALIASES = new Set([
  "to", "cc", "bcc", "mailto", "recipient", "recipients", "recipientlist",
  "email", "emails", "address", "addresses", "target", "targets",
  "recipientemail", "recipientemails", "recipientaddress", "recipientaddresses",
  "emailaddress", "emailaddresses", "targetemail", "targetemails",
  "targetaddress", "targetaddresses", "toemail", "toemails", "toaddress", "toaddresses",
  "url", "uri", "endpoint", "targeturl", "targeturi", "targetendpoint",
  "webhook", "webhookurl", "webhookuri", "requesturl", "requesturi",
  "destination", "destinationurl", "destinationuri", "callbackurl", "callbackuri",
  "baseurl", "apiendpoint", "host", "hostname", "origin", "channel", "topic",
]);

export function normalizeFieldName(field: string): string {
  return field.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function buildView(ctx: ToolSecurityContext): Record<string, ArgumentView> {
  const view: Record<string, ArgumentView> = Object.create(null) as Record<string, ArgumentView>;
  for (const leaf of argumentLeaves(ctx.args)) {
    view[leaf.path] = {
      field: leaf.field,
      value: leaf.value,
      source: Object.hasOwn(ctx.provenance, leaf.path) ? ctx.provenance[leaf.path] : [],
      taints: Object.hasOwn(ctx.taints, leaf.path) ? ctx.taints[leaf.path] : [],
    };
  }
  return view;
}

export function hasCapability(ctx: ToolSecurityContext, capability: SecurityCapability): boolean {
  return ctx.tool.capabilities.includes(capability);
}

function isSensitive(taint: TaintLabel): boolean {
  return SENSITIVE_TAINTS_SET.has(taint);
}

function isUntrusted(taint: TaintLabel): boolean {
  return UNTRUSTED_TAINTS_SET.has(taint);
}

export function sawOrderedIngestionThenPrivateAccess(ctx: ToolSecurityContext): boolean {
  const explicit = ctx.toolchain.sawIngestionThenPrivateAccess;
  if (typeof explicit === "boolean") return explicit;
  const ingestion = ctx.toolchain.path.indexOf("external_ingestion");
  const privateAccess = ctx.toolchain.path.indexOf("private_access");
  return ingestion >= 0 && privateAccess > ingestion;
}

export function sensitiveArgs(view: Record<string, ArgumentView>): string[] {
  return Object.entries(view)
    .filter(([, argument]) =>
      !SINK_FIELD_ALIASES.has(normalizeFieldName(argument.field)) &&
      argument.taints.some(isSensitive))
    .map(([name]) => name);
}

export function untrustedArgs(view: Record<string, ArgumentView>): string[] {
  return Object.entries(view)
    .filter(([, argument]) => argument.taints.some(isUntrusted))
    .map(([name]) => name);
}

export function credentialArgs(view: Record<string, ArgumentView>): string[] {
  return Object.entries(view)
    .filter(([, argument]) => argument.taints.includes("SECRET") || argument.taints.includes("API_KEY"))
    .map(([name]) => name);
}
