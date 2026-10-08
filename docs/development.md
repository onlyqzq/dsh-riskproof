# Development

## Prerequisites

- Node.js >= 22.19
- npm >= 10

## Setup

```bash
npm ci
```

## Commands

| Command | Purpose |
| ------- | ------- |
| `npm run build` | compile `src/` → `dist/` and build the DSH browser module |
| `npm test` | run the full Vitest suite |
| `npm run typecheck` | strict typecheck of `src/` |
| `npm run typecheck:test` | strict typecheck of `src/` + `tests/` |
| `npm run check:marketplace` | validate Awesome DSH Plugin-facing package metadata |
| `npm run verify` | source/test typecheck + package metadata + build + tests + smoke-runner and browser-bundle checks |
| `npm run test:coverage` | run tests and enforce coverage thresholds |
| `npm run check:dsh` | install exact tarball, boot the real host, exercise commands and protection |
| `npm run test:client-bundle` | exercise the built `dist/client.js` host loader, DOM rendering and disposal (run build first) |
| `npm run test:smoke-runner` | check legacy/RPC shutdown, timeouts and failure handling |
| `npm run check:web` | isolated real DSH Web + Chrome acceptance; requires Playwright and browser |
| `npm run pack:smoke` | build + `npm pack --dry-run` |

## Layout

| Area | Responsibility |
| ---- | -------------- |
| `src/index.ts`, `src/config.ts` | Plugin entry and deployment configuration |
| `src/core/`, `src/classification/` | Pure deterministic policy, types and capability detection; no DSH imports |
| `src/provenance/`, `src/toolchain/`, `src/proof/` | Bounded provenance, attack-chain state and redacted evidence |
| `src/dsh/` | DSH lifecycle, commands, report tool and authenticated dashboard RPC |
| `src/experience/` | Host-independent report/dashboard presentation and isolated rehearsals |
| `src/client/` | Browser beacon, panel and styles; compiled into the DSH module-loader format |
| `tests/unit/`, `tests/integration/`, `tests/security/` | Unit/client checks, host integration and security regressions |
| `scripts/`, `scripts/fixtures/` | Build and acceptance tools; private fixtures excluded from the npm package |
| `demo/`, `examples/` | Runnable demo and configuration examples |
| `docs/`, `artifacts/` | Documentation and ignored local validation outputs |

See [Architecture](architecture.md) for the call flow and individual module responsibilities.
For a UI change, start with `src/client/panel.ts` (lifecycle), `src/client/view.ts`
(rendering), `src/client/template.ts` (static markup) and `src/client/styles.ts`, and run
`npm test -- tests/unit/client.test.ts`. Run `npm run verify` before submitting;
packaged browser behavior is checked separately with `npm run check:web`.

## Adding a rule

1. Add the rule to the appropriate `src/core/rules/` module (stable `id`, `reason`, `evidence`) and register it in `src/core/rules/index.ts`.
2. Add test vectors to `tests/unit/engine.test.ts`.
3. If it changes the threat model, update `docs/security-model.md`.

The rule registry preserves evaluation order because receipt reasons and the first
UI finding depend on it. `src/core/engine.ts` prepares detector inputs and folds
results monotonically; `src/core/policy.ts` owns the default policy. Existing
engine exports are retained for compatibility.

## Browser build

The DSH browser entry is `src/client/panel.ts`. `tsc` emits ESM and declarations;
`scripts/build-client.mjs` additionally emits `dist/client.js` for the host's
`window.__ModuleLoader__`. Its module list is explicit and dependency-ordered:
`styles` → `template` → `view` → `panel`. Type-only dependencies are erased.
When adding runtime imports, update that list and run `npm run build` followed by
`npm run test:client-bundle`. The bundle test is part of `verify` and CI.

## Regression suites

Tests are grouped by responsibility. `tests/integration/runtime-security.test.ts`
covers identity pins, task contracts, receipts and inherited taint;
`tests/integration/output-control.test.ts` covers output blocking and trusted
declassification. Unit engine tests and `tests/security/` cover policy and attack
chains independently of browser presentation.

## Packaging a local tarball

```bash
npm run build
npm pack
```

Then install into a fresh profile:

```bash
DSH_HOME=/tmp/dsh-riskproof-smoke dsh plugin --profile test add ./dsh-riskproof-0.4.1.tgz
DSH_HOME=/tmp/dsh-riskproof-smoke dsh --profile test --dump-config
```

See `tests/` and `.github/workflows/ci.yml` for the automated equivalents.

The CI Web boot check preloads the host's HMR service through
`scripts/fixtures/ci-web-boot.patch.yml`. The tested DSH prereleases can otherwise
start watching user patches before that service is ready. This fixture changes
only the test host's startup order; the installed RiskProof configuration and
the command, tool-enforcement and receipt checks still use the candidate tarball.

For the current security delta see [v0.4 iteration](v0.4-product-upgrade.md); for browser
prerequisites and fixture boundaries, see the historical [v0.3 validation](v0.3-validation.md).

Client lifecycle tests use jsdom (development only) and include async session switches,
disconnects, inert metadata rendering and disposal. Browser acceptance separately validates
the packaged module in DSH and Chrome. No client source is excluded from coverage.

The installation smoke test inspects the composed profile for the SDK JSON-RPC server.
Legacy DSH versions may treat `sdk` as a custom base profile without an RPC listener;
they use the launcher's graceful SIGTERM path. SDK profiles require a shutdown response.
Both paths require completed assertions, exit code 0, no terminating signal and no timeout.
Use a direct DSH executable for `DSH_BIN`, not an `npx` wrapper. CI resolves that executable
with `npx --package=... -- which dsh` and uploads per-version lifecycle evidence on failure.

## Publishing

Follow [手动推送与版本发布](releasing.zh-CN.md) for code pushes, version bumps,
tag-triggered npm/GitHub releases, prerequisites and recovery steps.
