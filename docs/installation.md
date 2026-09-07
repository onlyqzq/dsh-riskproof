# Installation

RiskProof is a DeepSeek Harness plugin. Pick the install path that matches how you run DSH.

## From npm (recommended)

Prebuilt and fastest — no build step or `allowBuilds` approval. DSH requires Node.js 22.19+ and `pnpm` on `PATH` for plugin management:

```bash
dsh plugin --profile <profile> add dsh-riskproof@0.2.1
```

Pinning the patch release avoids a package manager release-age policy selecting
the incompatible `0.2.0` build. RiskProof 0.2.1 is tested against DSH
0.1.0-rc.7, 0.1.0-rc.8, 0.1.1-rc.2, and 0.1.2-rc.1.

DSH profiles intentionally disable automatic peer installation because the
host supplies Cordis and the DSH runtime singletons. pnpm may therefore print
a missing-peer warning during installation; do not add private copies of those
packages to the profile. A successful `dsh --profile <profile>` boot is the
compatibility check that matters.

The package's `dsh.bundle.patch` declaration automatically appends its bundled `riskproof` row to the profile's bundle stack. Do not insert a second row just to enable it.

Verify it is composed:

```bash
dsh --profile <profile> --dump-config
```

You should see a `riskproof` row from the `dsh-riskproof` package.

## From a prebuilt GitHub Release tarball

Each GitHub release publishes the exact tarball built by release CI. npm publication separately uses npm provenance. The tarball is useful for pinning an exact version:

```bash
dsh plugin --profile <profile> add \
  https://github.com/onlyqzq/dsh-riskproof/releases/download/v0.2.1/dsh-riskproof-0.2.1.tgz
```

## From source

Git-hosted installs run the package's `prepare` build and therefore require
DSH/pnpm build-script approval:

```bash
dsh plugin --profile <profile> add \
  github:onlyqzq/dsh-riskproof --allow-build dsh-riskproof
```

For development from a local checkout:

```bash
git clone https://github.com/onlyqzq/dsh-riskproof
cd dsh-riskproof
npm ci
npm run build
dsh plugin --profile <profile> add ./   # installs the local package
```

## Confirm it is active

RiskProof is a passive layer over the Tool Runtime — it registers no tools. To
see it decide in a real pipeline without a model or profile, run the bundled
demo:

```bash
npm run demo
```

It boots a real Cordis context and the real `@deepseek-ai/dsh-tools`
ToolRuntime, registers three mock tools, and drives the
`web → database → email` attack chain to a `deny`.
