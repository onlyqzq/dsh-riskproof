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
| `npm run verify` | source/test typecheck + package metadata + build + tests + smoke-runner checks |
| `npm run test:coverage` | run tests and enforce coverage thresholds |
| `npm run check:dsh` | install exact tarball, boot the real host, exercise commands and protection |
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
For a UI change, start with `src/client/panel.ts` and `src/client/styles.ts`, and run
`npm test -- tests/unit/client.test.ts`. Run `npm run verify` before submitting;
packaged browser behavior is checked separately with `npm run check:web`.

## Adding a rule

1. Add the rule to `src/core/engine.ts` (stable `id`, `reason`, `evidence`).
2. Add test vectors to `tests/unit/engine.test.ts`.
3. If it changes the threat model, update `docs/security-model.md`.

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
