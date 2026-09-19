// ============================================================================
// dsh-riskproof — DSH runtime glue
// ============================================================================
// Translates DSH ToolExecution / ToolExecutionResult into the core security
// model, evaluates it, and maps the decision back to the DSH PreToolDecision
// vocabulary. Never imports MCP/HTTP/Python concerns; this is the only place
// that touches DSH types.
// ============================================================================

import type { Context } from "@deepseek-ai/cordis";
import type {
  PostToolDecision,
  PreToolDecision,
  ToolExecution,
  ToolExecutionResult,
} from "@deepseek-ai/dsh-tools";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createHash } from "node:crypto";
import { toolFingerprint } from "../core/identity.js";
import type { ExecutionReceipt, OutputControlReceipt, TaskMode } from "../core/types.js";

import { resolveRiskProofConfig, type RiskProofConfig } from "../config.js";
import type {
  SecurityCapability,
  SecurityDecision,
  SecurityProof,
  TaintLabel,
  ToolSecurityContext,
} from "../core/types.js";
import { EMPTY_TOOLCHAIN_STATE } from "../core/types.js";
import { argumentsAsRecord } from "../core/arguments.js";
import { evaluate, type EnginePolicy } from "../core/engine.js";
import { detectValueTaints, enrichArgumentTaints, inferKindFromTool, TAINT_BY_KIND } from "../core/taint.js";
import { evaluateOutputFlow, type OutputFlowDecision } from "../core/output-policy.js";
import { classifyTool } from "../classification/classifier.js";
import { normalizeOverrides, type CapabilityOverrides } from "../classification/overrides.js";
import { ProofStore, newProofId, type ProofStoreStats } from "../proof/proof-store.js";
import { RuntimeState } from "./runtime-state.js";
import {
  configDecisionToInternal,
  decisionToPreToolDecision,
  mergePreToolDecisions,
} from "./decisions.js";

/** Cached capability resolution, invalidated on `tools/change`. */
class CapabilityResolver {
  private readonly globalCache = new Map<string, SecurityCapability[]>();
  private scopedCache = new WeakMap<Agent, Map<string, SecurityCapability[]>>();

  constructor(
    private readonly ctx: Context,
    private readonly overrides: CapabilityOverrides,
  ) {}

  resolve(name: string, agent?: Agent): SecurityCapability[] {
    if (Object.hasOwn(this.overrides, name)) return [...this.overrides[name]];
    let cache = this.globalCache;
    if (agent) {
      cache = this.scopedCache.get(agent) ?? new Map<string, SecurityCapability[]>();
      this.scopedCache.set(agent, cache);
    }
    const cached = cache.get(name);
    if (cached) return [...cached];

    let definition = this.ctx.tools.get(name);
    if (agent) definition = this.ctx.tools.get(name, agent) ?? definition;

    const capabilities = classifyTool({
      name,
      description: definition?.description,
      inputSchema: definition?.parameters,
    });
    cache.set(name, capabilities);
    return [...capabilities];
  }

  invalidate(): void {
    this.globalCache.clear();
    this.scopedCache = new WeakMap<Agent, Map<string, SecurityCapability[]>>();
  }
}

function buildEnginePolicy(config: RiskProofConfig["policy"]): EnginePolicy {
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

function argsAsRecord(args: unknown): Record<string, unknown> {
  return argumentsAsRecord(args);
}

function assertCompatibleHost(ctx: Context): void {
  const tools = (ctx as unknown as { tools?: { get?: unknown } }).tools;
  if (tools && typeof tools.get === "function") return;
  throw new TypeError(
    "dsh-riskproof: incompatible DSH Tool Runtime (expected ctx.tools.get()); " +
    "use a supported DSH release or upgrade dsh-riskproof",
  );
}

export class RiskProofRuntime {
  private readonly diagnostics = new Map<string, unknown>();
  private readonly pending = new Map<symbol, {
    proofId?: string;
    agentId?: string;
    started: number;
    gate: ExecutionReceipt["gate"];
    output?: OutputControlReceipt;
  }>();
  private readonly outputFlows = new Map<symbol, OutputFlowDecision>();
  private readonly config: RiskProofConfig;
  private readonly state: RuntimeState;
  private readonly proofStore: ProofStore;
  private readonly resolver: CapabilityResolver;
  private readonly enginePolicy: EnginePolicy;
  private readonly logger: ReturnType<Context["logger"]>;

  constructor(
    private readonly ctx: Context,
    config?: RiskProofConfig,
  ) {
    assertCompatibleHost(ctx);
    this.config = resolveRiskProofConfig(config);
    this.state = new RuntimeState(this.config);
    this.proofStore = new ProofStore({
      maxRecords: this.config.proof.maxRecords,
      file: this.config.proof.file,
    });
    this.resolver = new CapabilityResolver(ctx, normalizeOverrides(this.config.classification.overrides));
    this.enginePolicy = buildEnginePolicy(this.config.policy);
    this.logger = ctx.logger("riskproof");
  }

  /** `tools/pre-execute` waterfall listener body. */
  async preExecute(exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> {
    if (this.isDiagnostic(exec)) return next();
    const decision = this.evaluate(exec);
    const proofId = this.recordProof(exec, decision);
    const guidance = decision.remediations.slice(0, 2).join(" ");
    const reasonParts = ["RiskProof", decision.reason];
    const sources = decision.sources.map((source) => source.tool);
    if (sources.length) reasonParts.push(`Source / 来源: ${[...new Set(sources)].join(" → ")} → ${exec.name}`);
    if (guidance) reasonParts.push(`Recommended action: ${guidance}`);
    if (proofId) reasonParts.push(`proof ${proofId}; /riskproof trace`);
    const reason = reasonParts.join("; ");
    const mine = decisionToPreToolDecision(decision.decision, reason);

    if (this.config.mode === "observe" && mine.kind !== "allow") {
      this.logger.warn(
        `[observe] would ${mine.kind === "deny" ? "deny" : "ask"} tool '${exec.name}': ${decision.reason}`,
      );
    }

    try {
      const effective = this.config.mode === "observe" || mine.kind === "allow"
        ? await next()
        : mine.kind === "deny" ? mine : mergePreToolDecisions(mine, await next());
      const receipt: ExecutionReceipt = {
        gate: effective.kind,
        outcome: effective.kind === "deny" ? "blocked" : "pending",
      };
      if (proofId) {
        this.settle(proofId, receipt);
      }
      if (this.pending.size >= this.config.proof.maxRecords) {
        this.pending.delete(this.pending.keys().next().value!);
      }
      this.pending.set(exec.token, {
        ...(proofId ? { proofId } : {}),
        agentId: exec.agent?.id,
        started: Date.now(),
        gate: effective.kind,
      });
      return effective;
    } catch (error) {
      if (proofId) this.settle(proofId, { gate: "error", outcome: "error" });
      throw error;
    }
  }

  /** `tools/post-execute` waterfall: block sensitive model-facing output. */
  async postExecute(
    exec: ToolExecution,
    result: Readonly<ToolExecutionResult>,
    next: () => Promise<PostToolDecision>,
  ): Promise<PostToolDecision> {
    if (this.isDiagnostic(exec)) return next();
    if (!this.config.output.enabled) return next();
    const downstream = await next();
    if (downstream.kind === "block") return downstream;

    let effective: OutputFlowDecision;
    try {
      effective = this.evaluateOutput(exec, postDecisionPayload(result, downstream));
    } catch (error) {
      this.logger.warn(`could not evaluate output from tool '${exec.name}': ${safeErrorMessage(error)}`);
      if (this.config.mode === "observe") return downstream;
      const failed: OutputFlowDecision = {
        action: "block",
        taints: [],
        declassifiedTaints: [],
        blockedTaints: [],
      };
      this.rememberOutput(exec, failed);
      return {
        kind: "block",
        feedback: [{ type: "text", text: "RiskProof blocked a tool result because output policy evaluation failed." }],
      };
    }
    this.rememberOutput(exec, effective);
    if (effective.action === "block" && this.config.mode === "enforce") {
      return this.outputBlockDecision(effective);
    }
    if (effective.action === "block") {
      this.logger.warn(`[observe] would block sensitive output from tool '${exec.name}'`);
    }
    return downstream;
  }

  /** `tools/result` observer body. */
  onResult(exec: ToolExecution, result: ToolExecutionResult): undefined {
    if (this.isDiagnostic(exec)) return undefined;
    const outputFlow = this.outputFlows.get(exec.token);
    this.outputFlows.delete(exec.token);
    const pending = this.pending.get(exec.token);
    if (pending) {
      this.pending.delete(exec.token);
      const output = pending.output;
      if (pending.proofId) this.settle(pending.proofId, {
        gate: pending.gate,
        outcome: pending.gate === "deny" ? "blocked"
          : output?.action === "block" ? "output_blocked"
            : result.isError ? "error" : "succeeded",
        completedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - pending.started),
        ...(output ? { output } : {}),
      });
    }
    // Only authoritative success may record "data obtained". Failures never do.
    if (result.isError) return undefined;

    const session = this.state.get(exec.agent?.id);
    const capabilities = this.resolver.resolve(exec.name, exec.agent);
    const kind = inferKindFromTool(exec.name, capabilities);
    let contextIds: string[] = [];
    try {
      const flow = outputFlow ?? this.evaluateOutput(exec, outputPayload(result));
      const entry = session.tracker.record(kind, result.value, exec.name, flow.taints);
      if (entry) contextIds = [entry.id];
    } catch (error) {
      this.logger.warn(`could not index result from tool '${exec.name}': ${safeErrorMessage(error)}`);
    }

    if (this.config.toolchain.enabled) {
      session.guard.recordEvent(exec.name, capabilities, contextIds);
    }
    return undefined;
  }

  /** Invalidate the classifier cache when the registered tool set changes. */
  onToolsChange(): void {
    this.resolver.invalidate();
  }

  /** Remove a disposed agent's session state. */
  disposeAgent(agentId: string): void {
    this.state.dispose(agentId);
    for (const [token, pending] of this.pending) {
      if (pending.agentId === agentId) {
        this.pending.delete(token);
        this.outputFlows.delete(token);
      }
    }
  }

  /** Proofs recorded by this plugin instance (for diagnostics / tests). */
  listProofs(): SecurityProof[] {
    return this.proofStore.list();
  }

  /** Aggregate counts over the currently retained proof ring. */
  proofStats(): ProofStoreStats {
    return this.proofStore.stats();
  }

  /** Only return records for the caller's exact live agent scope. */
  report(agentId: string | undefined) {
    const session = this.state.peek(agentId);
    return {
      mode: this.config.mode,
      preset: this.config.policy.preset,
      language: this.config.experience?.language ?? "zh-CN",
      taskMode: session?.taskMode ?? this.config.task?.mode ?? "standard",
      proofEnabled: this.config.proof.enabled,
      provenanceEnabled: this.config.provenance.enabled,
      taintEnabled: this.config.taint.enabled,
      toolchainEnabled: this.config.toolchain.enabled,
      outputEnabled: this.config.output.enabled,
      persistent: !!this.config.proof.file,
      limit: this.config.proof.maxRecords,
      proofs: this.proofStore.list().filter((proof) => session !== undefined && proof.scopeId === session.scopeId),
    };
  }

  /** Operator-only adapter calls this; never exposed as an agent tool. */
  setTaskMode(agentId: string, mode: TaskMode): void {
    if (!["standard", "read-only", "local-only"].includes(mode)) throw new TypeError("invalid task scope");
    this.state.get(agentId).taskMode = mode;
  }

  markDiagnostic(name: string): void {
    this.diagnostics.set(name, this.ctx.tools.get(name)?.execute);
  }

  private isDiagnostic(exec: ToolExecution): boolean {
    const registered = this.diagnostics.get(exec.name);
    return registered !== undefined && registered === this.ctx.tools.get(exec.name, exec.agent)?.execute;
  }

  private settle(proofId: string, receipt: ExecutionReceipt): void {
    try { this.proofStore.settle(proofId, receipt); }
    catch { this.logger.warn("could not persist RiskProof execution receipt"); }
  }

  private evaluateOutput(exec: ToolExecution, payload: readonly unknown[]): OutputFlowDecision {
    const session = this.state.get(exec.agent?.id);
    const args = argsAsRecord(exec.arguments);
    const mapped = session.mapper.mapArguments(args);
    const inherited = this.config.taint.enabled
      ? Object.values(enrichArgumentTaints(args, mapped.provenance, mapped.taints)).flat()
      : [];
    const capabilities = this.resolver.resolve(exec.name, exec.agent);
    const kind = inferKindFromTool(exec.name, capabilities);
    const detected = payload.flatMap((value) => detectValueTaints(value));
    return evaluateOutputFlow(
      exec.name,
      inherited,
      TAINT_BY_KIND[kind],
      detected,
      this.config.output,
    );
  }

  private rememberOutput(exec: ToolExecution, flow: OutputFlowDecision): void {
    if (this.outputFlows.size >= this.config.proof.maxRecords) {
      this.outputFlows.delete(this.outputFlows.keys().next().value!);
    }
    this.outputFlows.set(exec.token, flow);
    const output: OutputControlReceipt = {
      action: flow.action === "block" && this.config.mode === "observe" ? "would_block" : flow.action,
      taints: [...flow.taints],
      declassifiedTaints: [...flow.declassifiedTaints],
    };
    const pending = this.pending.get(exec.token);
    if (!pending) return;
    pending.output = output;
    if (pending.proofId) this.settle(pending.proofId, {
      gate: pending.gate,
      outcome: "pending",
      output,
    });
  }

  private outputBlockDecision(flow: OutputFlowDecision): PostToolDecision {
    return {
      kind: "block",
      feedback: [{
        type: "text",
        text: `RiskProof blocked sensitive tool output (${flow.blockedTaints.join(", ")}). Use an operator-approved declassifier or remove the sensitive value.`,
      }],
    };
  }

  private evaluate(exec: ToolExecution): SecurityDecision & Required<Pick<SecurityProof, "identity" | "sources">> {
    const capabilities = this.resolver.resolve(exec.name, exec.agent);
    const session = this.state.get(exec.agent?.id);
    const definition = this.ctx.tools.get(exec.name, exec.agent) ?? this.ctx.tools.get(exec.name);
    const digest = toolFingerprint(definition ?? { name: exec.name });
    const identityStatus = session.identity.check(exec.name, digest);
    const args = argsAsRecord(exec.arguments);

    let provenance = Object.create(null) as Record<string, string[]>;
    let taints = Object.create(null) as Record<string, TaintLabel[]>;
    if (this.config.provenance.enabled || this.config.taint.enabled) {
      const mapping = session.mapper.mapArguments(args);
      provenance = mapping.provenance;
      taints = this.config.taint.enabled
        ? enrichArgumentTaints(args, mapping.provenance, mapping.taints)
        : mapping.taints;
    }

    const toolchainState = this.config.toolchain.enabled
      ? session.guard.snapshot()
      : EMPTY_TOOLCHAIN_STATE;

    const context: ToolSecurityContext = {
      identityStatus,
      taskMode: session.taskMode,
      tool: { name: exec.name, capabilities },
      args,
      provenance,
      taints,
      toolchain: toolchainState,
      execution: {
        callId: String(exec.callId),
        nested: exec.parent !== undefined,
      },
      internalDomains: this.config.policy.internalDomains,
    };

    const sourceIds = new Set(Object.values(provenance).flat());
    return {
      ...evaluate(context, this.enginePolicy),
      identity: { digest, status: identityStatus },
      sources: session.tracker.list().filter((entry) => sourceIds.has(entry.id))
        .map((entry) => ({ id: entry.id, tool: entry.label ?? "tool", taints: entry.taints })),
    };
  }

  private recordProof(exec: ToolExecution, decision: SecurityDecision & Required<Pick<SecurityProof, "identity" | "sources">>): string | undefined {
    if (!this.config.proof.enabled) return undefined;
    const proof: SecurityProof = {
      scopeId: this.state.get(exec.agent?.id).scopeId,
      mode: this.config.mode,
      taskMode: this.state.get(exec.agent?.id).taskMode,
      identity: decision.identity,
      sources: decision.sources,
      proofId: newProofId(exec.name, decision.decision, decision.timestamp),
      tool: exec.name,
      capabilities: this.resolver.resolve(exec.name, exec.agent),
      callId: createHash("sha256").update(this.state.get(exec.agent?.id).scopeId + String(exec.callId)).digest("hex").slice(0, 24),
      nested: exec.parent !== undefined,
      decision: decision.decision,
      riskLevel: decision.riskLevel,
      matchedRules: decision.matchedRules.map((rule) => ({
        id: rule.id,
        triggeredArgs: [...rule.triggeredArgs],
        evidence: [...rule.evidence],
        remediation: rule.remediation,
      })),
      provenanceSummary: decision.provenance,
      taintSummary: decision.taints,
      toolchain: decision.toolchain,
      reason: decision.reason,
      remediations: [...decision.remediations],
      timestamp: decision.timestamp,
    };
    try {
      return this.proofStore.save(proof);
    } catch (error) {
      this.logger.warn(`could not persist RiskProof proof: ${safeErrorMessage(error)}`);
      return proof.proofId;
    }
  }
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "unknown error";
}

function outputPayload(result: Readonly<ToolExecutionResult>): unknown[] {
  return result.isError
    ? [result.content, result.additionalContexts]
    : [result.value, result.content, result.additionalContexts];
}

function postDecisionPayload(
  result: Readonly<ToolExecutionResult>,
  decision: Extract<PostToolDecision, { kind: "accept" }>,
): unknown[] {
  const hasValue = Object.hasOwn(decision, "value");
  const hasContent = Object.hasOwn(decision, "content");
  const hasContexts = Object.hasOwn(decision, "additionalContexts");
  if (!hasValue && !hasContent) {
    return [...outputPayload(result), ...(hasContexts ? [decision.additionalContexts] : [])];
  }
  // A content-only replacement does not replace the canonical success value;
  // keep evaluating it because Code Mode and the result observer can still
  // consume that value even when Native model content was sanitized.
  if (hasContent) {
    return [
      ...(!result.isError ? [result.value] : []),
      decision.content,
      ...(hasContexts ? [decision.additionalContexts] : []),
    ];
  }
  return [
    ...(hasValue ? [decision.value] : []),
    ...(hasContexts ? [decision.additionalContexts] : []),
  ];
}
