# RiskProof 项目链路梳理（面试版）

## 1. 项目定位

RiskProof 是运行在 **DeepSeek Harness（DSH）Tool Runtime** 上的安全插件。它不负责调用工具，而是在工具执行前后接入生命周期，回答三个问题：

1. 本次参数里的数据来自哪里；
2. 数据是否带有不可信、隐私或凭据等安全标签；
3. 当前工具与之前的调用组合后，是否形成危险链路。

最终输出 `allow / ask / deny`，并生成可解释、可追溯的安全记录。

## 2. 一次工具调用的完整链路

```text
插件加载
  ↓
tools/pre-execute（副作用发生前）
  ↓
工具身份校验 → 能力分类 → 参数展开 → 来源匹配与污点识别
  ↓
工具链状态 + 路径/命令/目的地检测
  ↓
纯策略引擎：allow / ask / deny
  ↓
与其他插件的结果按最严格级别合并
  ↓
工具执行或被拦截
  ↓
tools/result（执行后）
  ↓
更新执行回执；仅成功结果进入来源索引和工具链历史
  ↓
浮标面板、/riskproof、riskproof_report 展示脱敏结果
```

### 2.1 加载与事件注册

安装包通过 `cordis.patch.yml` 加入 DSH profile。入口 `src/index.ts` 创建 `RiskProofRuntime`，注册四类事件：

- `tools/pre-execute`：执行前检查，是核心拦截点；
- `tools/result`：接收真实执行结果并更新状态；
- `tools/change`：工具定义变化后清空分类缓存；
- `agent/disposed`：会话结束时释放状态。

配置由 Schemastery 在加载时校验并补全，支持 `observe / enforce`、三档策略预设、域名规则、敏感路径和容量上限。配置错误会直接阻止插件以半配置状态启动。

### 2.2 执行前：构造安全上下文

`src/dsh/runtime.ts` 将 DSH 的 `ToolExecution` 转成统一的 `ToolSecurityContext`：

1. **会话隔离**：每个 Agent 独立维护来源索引、工具身份、任务模式和工具链历史，避免跨会话污染；状态都有数量和内存上限。
2. **身份连续性**：对工具名、描述、输入/输出 schema 计算指纹。同一会话中定义发生变化时拒绝执行，防止同名工具被替换。
3. **能力分类**：根据工具名、描述和输入 schema，用确定性规则映射为 `EXTERNAL_INGESTION`、`PRIVATE_ACCESS`、`EXTERNAL_ACTION`、`LOCAL_MUTATION`、`CODE_EXECUTION`、`CREDENTIAL_ACCESS`。支持人工 override；无法分类的工具默认请求确认。
4. **参数来源映射**：递归展开对象和数组为 `message.body`、`recipients[0]` 等稳定叶子路径，再用精确或有长度边界的子串匹配，把参数映射回之前的成功工具结果。
5. **污点分析**：来源标签与值检测结果做加法合并。典型标签包括 `UNTRUSTED_WEB`、`CUSTOMER_DATA`、`PII`、`SECRET`、`API_KEY`，普通中间工具不能自动洗掉标签。
6. **专项检测**：同时检查外部目的地、云元数据地址、敏感文件路径、破坏性命令、下载后直接执行和携带凭据的网络命令。
7. **工具链快照**：读取最近窗口内成功调用的能力顺序，识别 `外部摄入（EIT）→ 私密访问（PAT）→ 外部动作（NAT）`。

### 2.3 策略裁决

`src/core/engine.ts` 是无 IO、无 DSH 依赖、无 LLM 的纯函数规则引擎。所有规则都返回“决策、风险级别、命中参数、证据和修复建议”，再进行单调聚合：

- 决策只会从 `allow → require_approval → deny` 变严；
- 风险只会从 `low → medium → high → critical` 升高；
- 云元数据访问、凭据外发、灾难性系统命令等硬规则始终拒绝；
- 其他规则由 `permissive / balanced / strict` 预设控制。

内部的 `require_approval` 会映射为 DSH 的 `ask`。RiskProof 的结果还会与后续安全插件按最严格结果合并，因此不会覆盖别的插件已经给出的拒绝。`observe` 模式只记录“本应如何裁决”，不主动阻断。

### 2.4 执行后：状态更新与回执

每次执行前都会生成 proof，并用 DSH execution token 关联后续结果。收到 `tools/result` 后更新为 `blocked / succeeded / error` 及耗时。

只有权威成功结果才会：

- 写入 `ContextTracker`，供后续参数做来源匹配；
- 把本次能力写入 `ToolchainGuard`，供后续识别跨工具攻击链。

失败结果不会被记成“已获取数据”。Proof 默认保存在有界内存环中，也可追加写入 JSONL；其中不保存原始参数、结果、命令和凭据，只保留哈希、标签、来源 ID、规则和裁决等脱敏元数据。

### 2.5 展示层

插件提供三种只读查看方式：

- Web 安全浮标：通过 DSH 已认证 RPC 约每秒读取当前会话快照；
- `/riskproof` 命令：查看安全账单、来源链和设置任务边界；
- `riskproof_report` 工具：让模型展示状态、trace 或无副作用演练。

展示层只消费 `runtime.report()` 的脱敏快照，不读取聊天历史，也不会为了刷新面板再次调用模型。

## 3. 典型攻击链示例

```text
web_fetch(url)                         → 记录 UNTRUSTED_WEB / EIT
database_query("select ...")          → EIT 后发生 PAT，默认 ask
send_email(body="CUST-8842 ...")      → 参数匹配数据库结果并继承 CUSTOMER_DATA
                                      → EIT → PAT → NAT 完整成立
                                      → deny，邮件不会发送
```

这里的关键点不是某个工具天然危险，而是“不可信网页影响了私密读取，私密结果又准备外发”。RiskProof 同时使用调用顺序、真实参数中的数据来源和敏感标签，减少只凭工具名判断造成的误报。

## 4. 技术设计亮点

- **运行时与安全核心解耦**：DSH 适配集中在 `src/dsh/runtime.ts`，核心规则可独立单测。
- **确定性设计**：分类、匹配和裁决不依赖 LLM，结果稳定、可解释、便于回归测试。
- **执行前拦截、执行后取证**：危险副作用发生前裁决，之后再用真实结果更新状态，避免把失败调用当成事实。
- **纵向防御**：单次调用规则、数据流规则、跨工具时序规则、任务范围和工具身份共同工作。
- **有界与隐私优先**：会话、事件、上下文和 proof 都设上限；持久化记录不含正文。

## 5. 面试时可以这样概括

> 我做的是一个挂在 DSH 工具运行时上的有状态安全插件。执行前，它把工具元数据分类成安全能力，对嵌套参数做来源匹配和污点传播，再结合当前会话里的调用顺序、目的地、路径及命令风险，由纯规则引擎给出 allow、ask 或 deny。执行后，它只把成功结果加入来源索引和工具链，并用 execution token 补齐真实执行回执。整个方案不依赖 LLM，状态按会话隔离且有界，审计记录经过脱敏，所以同时兼顾了可解释性、性能和隐私。

## 6. 边界

RiskProof 只能保护经过 DSH `tools/pre-execute / tools/result` 的可观测调用。来源匹配主要覆盖复制、精确匹配和有限子串匹配，无法可靠识别改写、翻译、加密后的信息流；它也不能替代 OS 沙箱、网络防火墙或完整 DLP。

