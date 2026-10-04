# Architecture

RiskProof is a single Cordis plugin (`dsh-riskproof`) layered over the DSH Tool Runtime. It owns the security model; DSH owns the runtime.

## Layers

```text
                DeepSeek Agent
                      │
                      ▼
                DSH ToolRuntime
                      │
                      ▼
              tools/pre-execute
                      │
                      ▼
              ┌─────────────────┐
              │    RiskProof    │
              │  classification │
              │  provenance     │
              │  taint          │
              │  toolchain      │
              │  path/command   │
              │  destination    │
              │  engine         │
              └────────┬────────┘
                       │
              ┌────────┼────────┐
              ▼        ▼        ▼
            allow     ask      deny
                       │
                       ▼
                DSH Approval
                       │
                       ▼
                  Tool Execute
                       │
                       ▼
             tools/post-execute
                       │
              ┌────────┴────────┐
              ▼                 ▼
            accept             block
                       │
                       ▼
                  tools/result
                       │
              ┌────────┴────────┐
              ▼                 ▼
       ContextTracker        Toolchain
              │                 │
              └──── evidence ───┘
```

## Module map

| Path | Responsibility |
| ---- | -------------- |
| `src/index.ts` | Cordis plugin entry: `name`, `inject`, `Config`, `apply`. |
| `src/config.ts` | Schemastery schema; the single source of deployment tunables. |
| `src/dsh/runtime.ts` | DSH adapter: `ToolExecution` → `ToolSecurityContext` → `PreToolDecision`; `ToolExecutionResult` → state updates. |
| `src/dsh/decisions.ts` | Decision mapping (`require_approval` ↔ `ask`) and monotonic merge. |
| `src/dsh/capability-resolver.ts` | Global/scoped capability caches and tool-change invalidation. |
| `src/dsh/engine-policy.ts` | Translate deployment config decisions to core policy. |
| `src/dsh/output-payload.ts` | Select original and downstream-replaced result projections for inspection. |
| `src/dsh/runtime-state.ts` | Per-session state isolation. |
| `src/core/engine.ts` | Prepare detector inputs and aggregate rule results monotonically; preserve the public engine API. |
| `src/core/policy.ts` | Engine policy types and default decisions. |
| `src/core/rules/` | Ordered registry, shared argument view and rules grouped by egress, execution, provenance and invariants. |
| `src/core/arguments.ts` | Bounded nested-argument traversal and stable leaf paths. |
| `src/core/taint.ts` | Source inference + value-based taint detection. |
| `src/core/output-policy.ts` | Pure output-label policy and trusted declassification. |
| `src/core/destination.ts` | External destination / cloud-metadata detection. |
| `src/core/path-policy.ts` | Sensitive credential-path detection with bounded operator globs. |
| `src/core/command-risk.ts` | Bounded high-confidence destructive/network command checks. |
| `src/classification/` | Capability vocabulary, classifier, overrides. |
| `src/provenance/` | Bounded ContextTracker + ProvenanceMapper. |
| `src/toolchain/guard.ts` | Cross-tool EIT/PAT/NAT state. |
| `src/proof/` | Privacy-preserving ProofStore + redaction. |
| `src/experience/types.ts` | Explicit report snapshot contract, independent of the DSH runtime class. |
| `src/experience/` | Host-independent text reports, redacted dashboard snapshots and isolated rehearsals. |
| `src/dsh/experience.ts` | Native commands and the read-only report tool. |
| `src/dsh/dashboard.ts` | Read-only status endpoint on the host's authenticated RPC connection. |
| `src/client/panel.ts` | Session-aware polling, interactions, command events and disposal. |
| `src/client/view.ts` | Render redacted dashboard state into the DOM. |
| `src/client/template.ts`, `styles.ts` | Static markup and styles; dynamic metadata uses `textContent`. |
| `src/client/context.ts` | Minimal type contract for injected browser host services. |

The display path is `runtime.report()` → `experience/dashboard.ts` → authenticated
DSH RPC → `client/panel.ts`. Only redacted metadata reaches the panel. Pre-execution
denials and post-execution output blocks have distinct receipt labels: blocking a
result does not imply that the tool body or its side effects never ran.

## Rule organization

`core/rules/index.ts` is the single ordered registry. Rule modules import the shared
context helpers and pure detectors, never the engine or DSH adapter:

- `invariants.ts`: tool identity, task scope and unknown-tool policy.
- `egress.ts`: metadata endpoints, domain restrictions and outbound sensitive data.
- `execution.ts`: commands, local mutation and sensitive path access.
- `provenance.ts`: ordered cross-tool ingestion, private access and disclosure.

The engine evaluates every registered rule in order and folds decisions toward the
strictest result. Keep that order stable when moving code: it also determines reason,
evidence and remediation ordering, including the first rule rendered in the dashboard.

## Data flow (pre-execute)

1. `tools/pre-execute` receives the `ToolExecution`.
2. The adapter classifies the effective scoped tool (`name` + description + input schema, with config overrides). Same-name definitions are cached separately per agent scope.
3. The per-session `ProvenanceMapper` maps nested argument leaves back to tracked results, yielding provenance ids and taints.
4. Taints are enriched additively (source inference + value detection).
5. The toolchain guard contributes the observed EIT/PAT/NAT state.
6. Destination, sensitive-path, and command-risk detectors add deterministic local evidence.
7. The pure engine evaluates hard invariants and preset-resolved policy rules, then returns a `SecurityDecision` with remediation guidance.
8. The decision maps to `allow` / `ask` / `deny` and merges monotonically with downstream plugins.
9. A privacy-preserving proof is recorded, including rule ids and remediation but no raw path, command, arguments, or results.

## Data flow (result)

On a successful result only:

1. The adapter infers a context kind from the tool + capabilities.
2. When searchable content exists, the result value is recorded in the per-session `ContextTracker` (bounded, metadata + searchable text only).
3. The toolchain guard always records the successful capability event, with any produced context ids. Empty or unindexable results therefore preserve execution order without claiming data provenance.

Failures never record "data obtained".

## Data flow (post-execute)

1. The adapter derives inherited labels from the call arguments and source labels from the
   executed tool's capability/name class.
2. Deterministic detectors inspect the normalized result value, model-facing content and
   additional contexts without retaining them in a proof.
3. An exact-name trusted declassifier may remove configured inherited labels only.
4. Source and detected labels are added after declassification, restoring any label still
   evidenced by the actual output.
5. A configured blocked label returns DSH `block` feedback in enforce mode. Observe mode
   records `would_block` and accepts the result.
6. Downstream replacement projections are inspected before the final decision returns.

The final label set is cached only until `tools/result`, where it seeds the bounded context
entry. This makes the reduced label set available to later calls without persisting content.

## Why the core is DSH-free

`src/core/` and `src/classification/`, `src/provenance/`, `src/toolchain/` import no DSH types. This keeps the security decision logic independently unit-testable and prevents the engine from accidentally depending on live runtime state. The DSH adapter is the only seam that knows about `ToolExecution`, `ToolExecutionResult`, and `PreToolDecision`.

## Lifecycle & HMR

Every listener is registered with `ctx.on(...)`, which is fiber-owned: a config reload disposes the previous plugin instance (and its listeners, tracker, and guard) before activating the replacement. The classifier cache is invalidated on `tools/change`. Per-session state is released on `agent/disposed` and bounded as a safety net.
