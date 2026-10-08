# Installation and first use

## Install or update from npm

Node.js 22.19+ and `dsh` / `pnpm` on PATH are required:

```bash
dsh plugin --profile web add dsh-riskproof@0.4.1
```

The prebuilt npm package needs no local compilation. DSH supplies the official peer
runtime packages. Missing-peer warnings from profile pnpm are not by themselves a
startup failure; don't install duplicate private Cordis/DSH runtimes into the profile.
Restart your DSH profile after installing or updating.

## Build a local package

From a repository checkout:

```bash
npm ci
mkdir -p artifacts
npm pack --pack-destination artifacts
dsh plugin --profile web add ./artifacts/dsh-riskproof-0.4.1.tgz
dsh --profile web --dump-config
```

The dump must contain exactly one `riskproof` row with `name: dsh-riskproof` and
`config: {}`. The bundle is composed automatically; do not insert a second row.
Restart your DSH profile to load the installed version.

In the DSH conversation composer, enter:

```text
/riskproof
/riskproof demo
/riskproof doctor
/riskproof trace
```

The native command directory can discover RiskProof when you type `/`. The command
returns its report directly to DSH's command card without calling a model. The demo uses
isolated synthetic inputs with the default balanced engine; it never reads private files,
runs shell commands, or sends email, and does not affect the live protection counts.

For profiles without the native commands service, ask the agent to call `riskproof_report`
with `view: status`, `trace`, or `demo`. This tool cannot change security policy or task scope.
Normal model usage still incurs the host model's ordinary cost; the security decision
engine and direct slash commands do not call a model.

## From Git source

```bash
dsh plugin --profile web add github:onlyqzq/dsh-riskproof --allow-build dsh-riskproof
```

Git source runs `prepare`; inspect and approve the build as prompted by DSH/pnpm.
Git installs use the remote source; use an exact npm version for a reproducible release install.
For a local checkout, build first, then install the generated tarball as above.

## Check the loaded protection settings

Run `/riskproof doctor`, or expand **Protection checks** in the beacon overview.
For headless hosts, call `riskproof_report` with `view: health`. The findings identify
disabled checks, missing credential-output labels and effective rules more permissive
than balanced defaults. No private files or credentials are read, and no test tools run.
See [protection checks](protection-checks.md) for meanings and recovery steps.

## Remove the plugin

```bash
dsh plugin --profile web remove dsh-riskproof
```

Restart that profile. If you added a manual `riskproof` override in its patch, remove that
entry too. Operator-configured JSONL proof files remain under your control.

## If the beacon does not appear

1. Run `dsh --profile web --dump-config` and check for one `name: dsh-riskproof` row.
2. Restart the same profile you installed into; select a conversation in Web.
3. If the beacon reports a disconnect, click **Reconnect**. Headless/older hosts without
   the authenticated connection can still use `/riskproof` or `riskproof_report`.
4. For an English overview and receipts, set `experience.language: en` in the profile
   patch and restart; see [configuration](configuration.md).

Include DSH, Node and plugin versions plus the redacted error in an
[installation report](https://github.com/onlyqzq/dsh-riskproof/issues/new?template=bug_report.md).

## Task contracts

`/riskproof task read-only` adds a session-local restriction on writes, external actions,
shell/code execution, and unknown tools. `local-only` restricts network tools, shell/code
execution, and unknown tools. Shell is deliberately denied because arbitrary commands
cannot be proven read-only or local by capability classification.

`/riskproof task standard` removes the additional task restriction. Base safety rules
remain active. Only the human command or profile configuration changes this contract;
there is no policy-changing model tool. These are capability restrictions, not OS isolation.

## Reproduce installation checks

```bash
npm run verify
npm run test:coverage
npm pack --pack-destination artifacts
npm run check:dsh
```

`check:dsh` creates a new temporary DSH home, installs the exact tarball into fresh Web
and SDK profiles, verifies bundle composition, then boots the real host. It detects whether the profile has an SDK RPC server;
older base profiles close through the launcher’s graceful SIGTERM path.
Its temporary fixture exercises the registered commands, four rehearsals, a blocked
synthetic write (tool body must not run), the report tool, and a correlated receipt.
It performs no model requests and does not use your existing profile or credentials.
Evidence is written to `artifacts/dsh-install-check*.json` and `.log`.
`DSH_BIN=/path/to/dsh npm run check:dsh` tests another installed host version; use the
direct executable, not a shell wrapper around `npx`.

For automated browser acceptance, install Playwright in your development environment and
its Chromium browser, then run `npm run check:web`. Repeat with
`RISKPROOF_WEB_LANGUAGE=en npm run check:web` for English; its evidence is written
to `artifacts/web/en/`. If Playwright is installed elsewhere,
set `PLAYWRIGHT_MODULE` to its absolute `index.mjs` path; `CHROME_PATH` optionally selects
an installed Chrome executable. The script creates a fresh profile, starts DSH on a random
localhost port, and uses a local deterministic model fixture to exercise the actual Agent
loop. It does not use your API keys. Screenshots and evidence go to `artifacts/web/`.

For a manual check with your own model configuration:

```bash
# Pick a fresh directory for each rebuilt tarball to avoid package-manager cache reuse.
DSH_HOME=/tmp/riskproof-web-manual dsh plugin --profile web add ./artifacts/dsh-riskproof-0.4.1.tgz
DSH_HOME=/tmp/riskproof-web-manual dsh --profile web --no-open --port 19843
```

Open the exact URL printed by DSH, including its authentication token. Select a workspace,
then enter `/riskproof`, `/riskproof demo`, `/riskproof task read-only`, and `/riskproof trace`.
The beacon appears without a command and stays collapsed. Click it to inspect the compact
chart; ordinary tool activity should update it automatically. Commands are secondary entries.
Confirm the overview remains readable at narrow widths and a new session clears old risks. DSH 0.1.0-rc.7 does not accept `--no-open`; omit it there.

See the [v0.4 iteration record](v0.4-product-upgrade.md), the
[Chinese step-by-step Web checklist](web-acceptance.zh-CN.md), and the historical
[v0.3 validation evidence](v0.3-validation.md) for tested scope and limitations.
