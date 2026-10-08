# 手动推送与版本发布

本文适用于 `onlyqzq/dsh-riskproof`。所有命令都在项目根目录执行；每一步成功后再继续下一步。

项目当前采用 **GitHub 标签触发发布**：你手动提交代码、推送分支和版本标签，GitHub Actions 负责校验、发布 npm 包和创建 GitHub Release。工作流定义见 [CI](../.github/workflows/ci.yml) 和 [Publish](../.github/workflows/publish.yml)。

| 你的操作 | 自动发生的事情 |
| --- | --- |
| 推送 `main`，或提交目标为 `main` 的 PR | 运行 CI，包括 Node / DSH 兼容性和安装检查 |
| 推送 `v*` 标签，例如 `v0.4.2` | 运行 Publish，发布 npm 并创建 GitHub Release |
| 只在本地运行 `npm pack` | 生成本地 `.tgz`，不会上传或发布 |

## 一、首次准备

本地需要 Node.js **22.19 或以上**、npm **10 或以上**、Git，以及仓库的推送权限。

```bash
node --version
npm --version
git remote -v
git branch --show-current
```

`origin` 应指向 `onlyqzq/dsh-riskproof`。本项目使用 `package-lock.json` 锁定依赖；首次克隆或锁文件更新后执行：

```bash
npm ci
```

`npm ci` 会通过 `prepare` 自动构建 `dist/`。这是本地构建，不会触发发布。

维护者还需在 npm 的 `dsh-riskproof` 包设置中配置 GitHub Actions Trusted Publisher：

| 配置项 | 本仓库对应值 |
| --- | --- |
| Organization or user | `onlyqzq` |
| Repository | `dsh-riskproof` |
| Workflow filename | `publish.yml`，不要填完整路径 |
| Environment name | 留空；实际发布的 `publish-npm` job 没有 environment |
| Allowed actions（如界面显示） | 允许直接 `npm publish` |

发布使用 OIDC，不依赖本地 `npm login` 或长期 `NPM_TOKEN`。npm 官方要求 OIDC 发布端使用 npm >=11.5.1、Node >=22.14；当前工作流在发布 job 使用 Node 24。后续的 `record-npm-deployment` job 才使用名为 `npm` 的 GitHub environment，它只确认版本可见，不负责认证发布。配置规则见 [npm Trusted Publishing 官方文档](https://docs.npmjs.com/trusted-publishers/)。本文描述仓库所需配置，不代表已检查远端账户设置。

## 二、日常更新：只推送代码

适用于同步源码、修改文档，或暂时不发 npm 新版本的情况。

1. 查看变更，运行检查：

   ```bash
   git status --short
   git diff
   npm run verify
   ```

2. 暂存并检查将要提交的文件。下面的 `git add -A` 会包含所有未被忽略的新文件和改动；如果只想提交部分文件，改用 `git add 文件路径`。确认没有本地笔记或无关改动混入。

   ```bash
   git add -A
   git diff --cached --stat
   git diff --cached
   git commit -m "refactor: organize project modules and documentation"
   ```

   提交说明按本次改动调整。`dist/`、`node_modules/`、`coverage/` 和 `artifacts/` 都是生成内容，不需要提交。

3. 如果你在 `main` 上维护项目：

   ```bash
   git pull --rebase origin main
   npm run verify
   git push origin main
   ```

   如果 rebase 有冲突，解决并执行 `git rebase --continue`，再检查和推送。不要用强制推送覆盖远端变更。

   如果你在功能分支上，使用 `git push -u origin 分支名` 后通过 PR 合入 `main`；有分支保护时也使用 PR 流程。

4. 打开 [GitHub Actions](https://github.com/onlyqzq/dsh-riskproof/actions)，确认该提交的 **CI** 成功。

到这里代码已经推送，但 npm 版本没有变化。

## 三、发布一个新的 npm 正式版本

### 1. 从已同步的 main 开始

先按上一节提交或妥善保存工作区改动，再执行：

```bash
git switch main
git pull --ff-only origin main
git status --short
```

确保 `git status --short` 没有输出。不要把已有未提交文件顺带混入版本提交。

### 2. 更新版本号和 Changelog

选择一个尚未发布的版本。补丁修复或保持行为的重构通常使用 `patch`：

```bash
npm version patch --no-git-tag-version
node -p "require('./package.json').version"
```

这会同时更新 `package.json` 和 `package-lock.json`，暂时不创建提交或标签。增加兼容功能可改用 `minor`；需要明确目标版本时，可使用 `npm version 0.4.2 --no-git-tag-version`（数字仅为示例，不要重复使用已发布版本）。

编辑 [CHANGELOG.md](../CHANGELOG.md)：将 `Unreleased` 下本次内容整理到新版本标题中，写入实际发布日期，并保留一个新的空 `Unreleased` 段落。

### 3. 验证源码和将要发布的文件

```bash
npm run verify
npm run test:coverage
npm run pack:smoke
```

- `verify`：源代码和测试类型检查、市场元数据、构建、回归测试、smoke runner 与浏览器发布产物检查。
- `test:coverage`：检查覆盖率门槛。
- `pack:smoke`：预览 npm 文件清单，不发布。

`package.json` 的 `files` 包含整个 `docs/`，npm 打包不以 Git 是否跟踪文件为准。检查打包清单，确保没有临时笔记、私密资料或其他不应公开的文档；应包含 `dist/index.js`、`dist/client.js`、声明文件和 `cordis.patch.yml`。

涉及宿主集成或界面改动时，再测试实际包：

```bash
mkdir -p artifacts
npm pack --pack-destination artifacts
npm run check:dsh
```

`check:dsh` 默认使用 `PATH` 中的 `dsh`，并在临时配置目录安装当前版本的 tarball。可用 `DSH_BIN=/绝对路径/dsh npm run check:dsh` 选择实际可执行文件。

界面验收使用 `npm run check:web`，需要 Playwright 和浏览器，详情见 [Web 验收](web-acceptance.zh-CN.md) 与 [开发指南](development.md)。每次修改候选代码后，重新 `npm pack --pack-destination artifacts` 再验收，避免测到上一次的包。

### 4. 提交版本变更并推送 main

```bash
git add package.json package-lock.json CHANGELOG.md
git diff --cached
RELEASE_VERSION="$(node -p "require('./package.json').version")"
git commit -m "chore: release v${RELEASE_VERSION}"
git push origin main
```

如果还有与版本相关的 README 等变更，也应显式暂存。若仓库要求 PR，将版本提交通过 PR 合入 `main` 后，切回本地 `main` 并执行 `git pull --ff-only origin main`。

**等这个版本提交的 CI 全部通过后，再创建和推送标签。** Publish 会重新跑 `verify`，但不会替你等待 `main` 上的完整 DSH / Node 兼容性矩阵。

### 5. 创建并推送与 package.json 完全一致的标签

确认仍在 `main`，工作区干净，本地 HEAD 就是刚通过 CI 的版本提交：

```bash
git branch --show-current
git status --short
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
```

两个提交哈希应一致。若远端已前进，先同步、重新检查版本，并确认对应提交的 CI 状态。

```bash
RELEASE_VERSION="$(node -p "require('./package.json').version")"
git tag -a "v${RELEASE_VERSION}" -m "Release v${RELEASE_VERSION}"
git show --stat "v${RELEASE_VERSION}"
git push origin "v${RELEASE_VERSION}"
```

最后一条命令会触发公开发布。只推送本次标签，避免 `git push --tags` 把其他本地标签一起发出去。标签必须带 `v` 且与包版本完全一致，例如包版本 `0.4.2` 对应 `v0.4.2`。

当前流程面向正式版本：Publish 使用默认 npm dist-tag，并将 GitHub Release 标记为 latest。不要直接用它发布 `-rc` / `-beta` 测试版本；如需预发布，应先调整工作流的 npm tag 和 Release prerelease 设置。

### 6. 确认发布成功

在 [Publish 工作流](https://github.com/onlyqzq/dsh-riskproof/actions/workflows/publish.yml) 中依次确认：

1. `verify`：校验标签、检查代码并构建 tarball。
2. `publish-npm`：下载已验证的同一个 tarball，经 OIDC 发布到 npm。
3. `record-npm-deployment`：等待 npm 可查询到该版本。
4. `github-release`：创建 Release 并附上 tarball。

在终端复核：

```bash
RELEASE_VERSION="$(node -p "require('./package.json').version")"
npm view "dsh-riskproof@${RELEASE_VERSION}" version
npm view dsh-riskproof dist-tags --json
```

再检查 [npm 包页面](https://www.npmjs.com/package/dsh-riskproof) 和 [GitHub Releases](https://github.com/onlyqzq/dsh-riskproof/releases)。普通版本更新沿用已有插件收录，不需要在本地额外执行 `npm publish`。

## 四、常见失败及处理

| 现象 | 处理方式 |
| --- | --- |
| 推送 main 后没有 npm 新版本 | 正常；只有推送 `v*` 标签才触发 Publish。 |
| 标签与包版本不一致 | 检查标签指向提交中的 `package.json`。不要覆盖已公开的发布标签；修正后准备新的版本。 |
| 本地标签已存在 | 用 `git show 标签名` 和 `git ls-remote --tags origin 标签名` 检查现有记录；不要直接用 `-f` 重建。 |
| OIDC / 权限错误 | 核对 npm Trusted Publisher 的用户、仓库、工作流文件名和 environment，确认发布 job 有 `id-token: write`，并查看 job 日志。 |
| GitHub environment 等待确认 | 若 `npm` environment 配有 reviewer，按仓库设置完成批准；此阶段 npm 可能已经发布成功。 |
| npm 已发布，但 Release 创建失败 | 保留现有版本和标签，从 Actions 重跑失败的 job；无需再次本地发布。 |
| 网络或 registry 短暂不可用 | 在同一次 Actions run 中重跑失败 job，优先复用已构建的 artifact。 |
| 同版本已发布且完整性不一致 | 工作流会拒绝覆盖。npm 版本不可用不同内容重发；修复后提升版本号并重新走流程。 |
| artifact 已过期，无法重跑后续 job | 当前保存期为 7 天。重新构建不保证 tarball 哈希一致；已发布时优先准备新补丁版本，不要绕过完整性检查。 |
| 发布后发现问题 | 修复后发布新的补丁版本；保留历史标签和发布记录。 |

工作流会比较已发布版本和候选 tarball 的 `dist.integrity`，完全一致时跳过重复发布。这个行为用于恢复失败流程，不意味着可以修改同一版本的内容。


## 五、发布后的展示与增长复核

代码通过检查和发布后，还要确认用户能看到本次改进：

1. 在 npm 和 GitHub 首页核对中英文安装步骤、版本和兼容表；以发布后的实际页面为准。
2. 在 [已有插件目录](https://awesome-dsh-plugin.com/p/onlyqzq/dsh-riskproof/) 核对描述和 README；
   如需提交收录更新，使用 [调研文档中的中英文文案](auto-review-benchmark.zh-CN.md#可用于收录更新的文案)，按目录实际维护规则操作。
3. 在候选包上验证 `/riskproof doctor` 与 Web“防护检查”：诊断不改变策略、不增加记录；
   观察模式、缺失凭据标签和显式放宽规则提示准确。详见 [检查指南](protection-checks.md)。
4. 在候选包上分别验证 `experience.language: zh-CN` / `en`：浮标、风险标题、输出拦截、断线提示和窄屏可读性。
5. 记录公开指标的采集时间与 npm 窗口，在第 7／30 天复核；统计方法和局限见 [增长验证计划](auto-review-benchmark.zh-CN.md#发布后-30-天如何判断是否有效)。

下载次数不是独立安装人数；不要用未经核实的增长归因或安全承诺更新宣传。
