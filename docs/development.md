# Development

## Prerequisites

- Node.js >= 22.19
- npm >= 10

## Setup

```bash
npm install
```

## Commands

| Command | Purpose |
| ------- | ------- |
| `npm run build` | compile `src/` → `dist/` and build the DSH browser module |
| `npm test` | run the full Vitest suite |
| `npm run typecheck` | strict typecheck of `src/` |
| `npm run typecheck:test` | strict typecheck of `src/` + `tests/` |
| `npm run check:marketplace` | validate Awesome DSH Plugin-facing package metadata |
| `npm run verify` | source/test typecheck + build + test |
| `npm run test:coverage` | run tests and enforce coverage thresholds |
| `npm run check:dsh` | install exact tarball, boot the real host, exercise commands and protection |
| `npm run test:smoke-runner` | check legacy/RPC shutdown, timeouts and failure handling |
| `npm run check:web` | isolated real DSH Web + Chrome acceptance; requires Playwright and browser |
| `npm run pack:smoke` | build + `npm pack --dry-run` |

## Layout

- `src/core/` — pure deterministic engine; must stay DSH-free.
- `src/dsh/` — the only code importing DSH types.
- `src/client/` — browser beacon, compact charts and session-aware polling; built into the DSH module-loader format.
- `scripts/fixtures/` — private Web acceptance fixtures, excluded from the npm package.
- `tests/unit/` — pure unit tests.
- `tests/security/` — attack-chain regression fixtures.
- `tests/integration/` — real Cordis plugin lifecycle tests.

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
DSH_HOME=/tmp/dsh-riskproof-smoke dsh plugin --profile test add ./dsh-riskproof-0.3.0.tgz
DSH_HOME=/tmp/dsh-riskproof-smoke dsh --profile test --dump-config
```

See `tests/` and `.github/workflows/ci.yml` for the automated equivalents.

For browser prerequisites and fixture boundaries, see [validation](v0.3-validation.md).

Client lifecycle tests use jsdom (development only) and include async session switches,
disconnects, inert metadata rendering and disposal. Browser acceptance separately validates
the packaged module in DSH and Chrome. No client source is excluded from coverage.

The installation smoke test inspects the composed profile for the SDK JSON-RPC server.
Legacy DSH versions may treat `sdk` as a custom base profile without an RPC listener;
they use the launcher's graceful SIGTERM path. SDK profiles require a shutdown response.
Both paths require completed assertions, exit code 0, no terminating signal and no timeout.
Use a direct DSH executable for `DSH_BIN`, not an `npx` wrapper. CI resolves that executable
with `npx --package=... -- which dsh` and uploads per-version lifecycle evidence on failure.
