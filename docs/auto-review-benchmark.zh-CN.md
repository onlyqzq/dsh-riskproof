# dsh-auto-review 调研与 RiskProof 优化

调研日期：2026-10-08。结论：值得借鉴的是明确的使用收益、低摩擦安装和生态分发；RiskProof 应继续围绕跨工具数据流和敏感输出保护形成自己的定位。公开数据不能证明具体功能导致了增长。

## 数据口径

| 来源及统计窗口 | dsh-auto-review | dsh-riskproof |
| --- | ---: | ---: |
| 插件目录页面 stars 快照 | 170 | 7 |
| 插件目录页面近 30 日下载快照 | 4,648 | 1,053 |
| npm API 返回窗口：2026-09-05 至 2026-10-04 | 6,237 | 1,434 |

目录来源：[auto-review 页面](https://awesome-dsh-plugin.com/p/PerryLink/dsh-auto-review/)、[RiskProof 页面](https://awesome-dsh-plugin.com/p/onlyqzq/dsh-riskproof/)。npm 来源：[auto-review API](https://api.npmjs.org/downloads/point/last-month/dsh-auto-review)、[RiskProof API](https://api.npmjs.org/downloads/point/last-month/dsh-riskproof)。API URL 是滚动窗口，之后打开会变化；表中保留本次实际响应的 start/end，并非截至调研日的最新完整窗口。GitHub API 本次限流，stars 使用目录快照，没有冒充实时 GitHub 数据。

同一 npm 窗口中，对方下载约为 RiskProof 的 4.35 倍；目录 star 快照约为 24.3 倍。不同指标的比例差异本身不解释原因。npm 下载含 CI、重复安装和依赖安装；它不提供活跃用户、留存或下载来源。目录记录两者于 8 月 15 日／19 日加入，也不足以认定创建时间或先发红利。

## 它具体怎么实现

从作者的 [插件入口](https://github.com/PerryLink/dsh-auto-review/blob/main/src/index.ts)、[runtime](https://github.com/PerryLink/dsh-auto-review/blob/main/src/runtime.ts)、[review](https://github.com/PerryLink/dsh-auto-review/blob/main/src/review.ts) 和 [isolation](https://github.com/PerryLink/dsh-auto-review/blob/main/src/isolation.ts) 核对：

1. 在 DSH 原生 `approval/request` 审批链上按策略处理请求；不归它处理的请求继续交给后续 answerer。
2. 启动一次性只读审查子代理，使用结构化 allow/deny、理由和风险等级；异常默认走拒绝回退。
3. 针对审查子代理过滤注入上下文，并限制工具集合，降低仓库指令干扰审查的机会。
4. 把拒绝理由反馈给发起工具调用的模型；预算、熔断和审计让运行状态可检查。

这些机制解决的是“由第二个模型处理审批”。RiskProof 的执行前门控、结果输出检查、污点和来源匹配解决另一层问题。此次保持确定性安全路径；没有为模仿对方增加审查模型，也没有宣称两个插件已完成联合验收。

## 哪些因素可能帮助它获得 stars 与下载

以下是基于 [作者 README](https://github.com/PerryLink/dsh-auto-review#readme) 的产品推断，不是流量归因结果：

| 可观察事实 | 可能作用 | 对 RiskProof 的启发 |
| --- | --- | --- |
| 开头直接讲自动处理审批 | 用户容易把功能对应到反复确认的日常痛点 | 开头直接讲敏感数据外发和输出保护 |
| 提供 npm、GitHub、tarball 和 1024 商店入口 | 降低安装摩擦，扩大被发现的机会 | 优先 npm 预构建包，保留源码路径；确认渠道规则后再扩展 |
| README 有五种语言入口 | 扩大可阅读人群 | 先让已有英文文档对应的真实界面支持英文 |
| README 链接作者的 40+ 插件家族与知识库 | 可能产生跨项目曝光 | 用工具映射、真实案例和兼容测试参与生态 |
| 明确的 star 邀请，功能不与 star 绑定 | 用户容易找到支持项目的方式 | 在贡献入口提供自然、可选的邀请 |
| 兼容表、排障、审计与限制说明 | 降低试用的不确定性 | 已验证范围前置，避免把声明范围当验收证据 |

无法从这些页面确认社交传播、商店导流占比、star 历史曲线或付费推广；没有依据判断刷量，也不作此推断。功能数量和 README 长度不是增长的充分条件。

## 本轮实际落地

- 中英文 README 把安装、配置检查、无副作用演练及已验证兼容范围放到前面；突出无需额外 LLM 调用的收益。
- Web 浮标、概览、辅助技术标签与风险回执统一遵循 `experience.language`。断线保留已知语言；旧快照缺少字段时使用页面语言回退。
- 补充与 auto-review 的选择说明、卸载和浮标排障入口。邀请用户贡献脱敏误报及工具映射。
- 增加语言切换、英文风险回执、观察模式归属、隐私与发布浏览器包回归验证。

当前仓库已有执行回执、任务范围、工具元数据变化检测和输出拦截。本轮复用这些能力，没有把已实现能力写成新增成果。

## 发布后 30 天如何判断是否有效

| 时间 | 操作 | 保留的证据 |
| --- | --- | --- |
| 发布前 | 记录 GitHub stars、npm 7/30 日窗口、版本及兼容验收 | 时间、窗口 start/end、公开接口响应；GitHub API 限流时明确缺失 |
| 发布当天 | 按发布指南发布；确认 npm README 和已有目录展示更新 | 发布版本、Release、目录状态；目录更新机制需以其实际规则为准 |
| 第 7 天 | 检查安装失败、误报、英文界面反馈 | Issue 个数及人工分类；有条件时由维护者查看 GitHub traffic |
| 第 14 天 | 根据真实问题修复最常见阻碍；准备一个脱敏使用案例 | 复现步骤、修复版本、案例链接 |
| 第 30 天 | 比较同长度窗口的下载、stars 增量和问题趋势 | 原始窗口与变化，注明 CI／推广／版本发布等干扰因素 |

不用下载量冒充安装转化率；没有访问人数和完成安装人数，就无法算转化率。不同日期的滚动 30 日窗口可能重叠，不能视为独立实验。用户会话不增加遥测。

优先后续工作：验证较新 DSH 宿主及 peer 范围（当前实测集中在旧 rc 版本）；积累常用工具映射和误报用例；用真实脱敏流程制作短演示。MCP 独立服务、大量语言翻译、AI 审查和功能堆叠暂不作为增长前提。

## 可用于收录更新的文案

中文：

> DSH 敏感工具输出与跨工具数据流保护：外发前拦截可匹配的敏感流，常驻中英文安全浮标展示脱敏来源链与执行回执；确定性规则无需额外 LLM 调用。

English:

> Protect sensitive tool output and cross-tool data flows in DSH. A bilingual security beacon shows redacted provenance and execution receipts; deterministic rules require no extra LLM calls.

文案用于下一次发布与收录更新；本轮没有向外部平台提交或发布。
