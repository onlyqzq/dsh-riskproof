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
| `npm run check:dsh` | install exact tarball, boot real DSH SDK, exercise commands and protection |
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
