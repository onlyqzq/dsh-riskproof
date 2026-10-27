# Security Policy

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| 0.7.x   | :white_check_mark: |
| < 0.7   | Upgrade to the latest release |

Fixes target the latest published release. DSH host compatibility is listed in
[the installation guide](docs/installation.md) and the README compatibility table.

## What RiskProof is

RiskProof is a **plugin inside the DeepSeek Harness Tool Runtime**. It makes deterministic, evidence-backed allow / ask / deny decisions before execution and can block sensitive results before they reach model context. It does not execute tools itself, does not hold secrets, and does not replace the DSH sandbox or approval service.

## Trusted computing base

RiskProof trusts, and therefore assumes the integrity of:

- the DeepSeek Harness process and its Tool Runtime (`@deepseek-ai/dsh-tools`)
- the Cordis plugin lifecycle (`@deepseek-ai/cordis`)
- the DSH approval service (for `ask` decisions)
- the process running RiskProof (its memory and its proof output directory)

RiskProof is **not** a boundary against a compromised harness process. If the process, a loaded plugin with equal access, or the host is compromised, a `tools/pre-execute` listener can be bypassed or its decision ignored.

## Supported DSH paths

RiskProof protects tool calls that traverse the supported pipeline:

- `tools/pre-execute` — the allow / ask / deny gate before dispatch
- `tools/post-execute` — sensitive output control before model-visible results are committed
- `tools/result` — the observe-only success notification that updates provenance and toolchain state

Both native tool calling and Code Mode sub-dispatches re-enter this pipeline, so both are covered. A tool that the harness executes outside this pipeline is not observed.

## Known limitations

### Provenance

Provenance is recovered with **exact and bounded substring matching** over per-session tool results. RiskProof does **not** track:

- summarization, translation, or semantic paraphrase
- Base64 / compression / encryption transformations
- multi-fragment recombination that no longer contains a tracked substring
- reasoning that happens invisibly inside the model

RiskProof tracks *supported observable data flows*, not all information flows.

### Taint

Taint detection is pattern-based and additive. It can be evaded by an adversary who transforms data past the recognized patterns. It is not a semantic DLP.

### Proofs

Proofs are audit evidence of RiskProof's own decision, not proof that a real-world side effect did or did not occur. In enforce mode, a `deny` gate receipt records a call stopped before execution. An output block happens after the tool body has run and does not undo its side effects. Observe mode records recommendations without RiskProof blocking; a successful tool result is not proof that its external effect happened.

Optional JSONL persistence contains redacted decision metadata, source ids, and taint labels, not raw arguments or results. New files use mode `0600`; deployers must secure the parent directory and define rotation, retention, and backup policies.

### Single-process scope

State is per-session and in-memory. It does not span processes, machines, or sessions. Restarting the harness resets provenance and toolchain state.

### Determinism, not adversarial AI

RiskProof uses no LLM for security decisions. It cannot reason about a tool's *actual* behavior beyond its declared metadata and observable arguments/results.

## Reporting a vulnerability

Please report privately rather than opening a public issue. Include:

- the DSH and RiskProof versions
- a minimal reproduction
- whether the issue is a bypass (false negative), a false positive, or a stability/DoS issue

Submit reports through [GitHub's private security advisory form](https://github.com/onlyqzq/dsh-riskproof/security/advisories/new). We aim to acknowledge within 7 days and publish a fix and advisory for confirmed issues.
