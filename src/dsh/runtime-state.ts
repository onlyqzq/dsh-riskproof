// ============================================================================
// dsh-riskproof — per-session runtime state
// ============================================================================
// RiskProof state (provenance tracker, provenance mapper, toolchain guard) is
// isolated per agent/session so one session's data flow never contaminates
// another's toolchain. The global bucket is used only for agent-less calls.
// ============================================================================

import type { RiskProofConfig } from "../config.js";
import { ContextTracker } from "../provenance/context-tracker.js";
import { ProvenanceMapper } from "../provenance/mapper.js";
import { ToolchainGuard } from "../toolchain/guard.js";
import { randomUUID } from "node:crypto";
import { ToolIdentityTracker } from "../core/identity.js";
import type { TaskMode } from "../core/types.js";

export interface SessionState {
  scopeId: string;
  identity: ToolIdentityTracker;
  taskMode: TaskMode;
  tracker: ContextTracker;
  mapper: ProvenanceMapper;
  guard: ToolchainGuard;
}

const GLOBAL_SCOPE = "__riskproof_global__";

/** Upper bound on concurrently tracked sessions (safety net on top of disposal). */
const MAX_SESSIONS = 256;

export class RuntimeState {
  private readonly sessions = new Map<string, SessionState>();

  constructor(private readonly config: RiskProofConfig) {}

  peek(agentId: string | undefined): SessionState | undefined {
    return this.sessions.get(agentId ?? GLOBAL_SCOPE);
  }

  get(agentId: string | undefined): SessionState {
    const key = agentId ?? GLOBAL_SCOPE;
    const existing = this.sessions.get(key);
    if (existing) return existing;

    // Dropping live state would silently forget identity pins and task limits.
    // Fail closed at capacity; normal agent disposal releases the slot.
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new Error("RiskProof session capacity reached; close unused sessions before starting another.");
    }

    const tracker = new ContextTracker({
      maxEntries: this.config.provenance.maxEntries,
      maxEntryBytes: this.config.provenance.maxEntryBytes,
      maxTotalBytes: this.config.provenance.maxTotalBytes,
      minMatchLength: this.config.provenance.minMatchLength,
    });
    const session: SessionState = {
      scopeId: randomUUID(),
      identity: new ToolIdentityTracker(),
      taskMode: this.config.task?.mode ?? "standard",
      tracker,
      mapper: new ProvenanceMapper(tracker),
      guard: new ToolchainGuard({
        maxEvents: this.config.toolchain.maxEvents,
        chainWindow: this.config.toolchain.chainWindow,
      }),
    };
    this.sessions.set(key, session);
    return session;
  }

  /** Remove a disposed session's state so memory does not grow unbounded. */
  dispose(agentId: string | undefined): void {
    const key = agentId ?? GLOBAL_SCOPE;
    const session = this.sessions.get(key);
    if (session) {
      session.tracker.clear();
      session.guard.clear();
      this.sessions.delete(key);
    }
  }

  clear(): void {
    for (const session of this.sessions.values()) {
      session.tracker.clear();
      session.guard.clear();
    }
    this.sessions.clear();
  }
}
