# Protection checks / 防护检查

RiskProof explains the configuration currently loaded by the plugin. In Web, click the
beacon and expand **Protection checks / 防护检查**. It stays collapsed until you open it.
For text output, enter this directly in the DSH composer:

```text
/riskproof doctor
```

Headless hosts can use the existing read-only tool:

```json
{ "view": "health" }
```

The tool name is `riskproof_report`. The slash command makes no model calls; asking a
model to invoke the tool uses the host's ordinary model route. Neither interface changes
policy, dispatches test tools or adds protection records.

## What the checks mean

| Check | Finding and next step |
| --- | --- |
| Execution protection | Observe mode records recommendations. Set `mode: enforce` when blocking is intended. |
| Execution evidence | `proof.enabled: false` disables accounting; zero records does not establish inactivity. |
| Provenance matching | Enable `provenance.enabled` to match observable tool-result origins. |
| Sensitive label propagation | Enable `taint.enabled` for argument-side label analysis. |
| Cross-tool chain detection | Enable `toolchain.enabled` for cross-call attack-chain detection. |
| Credential output protection | Check `output.enabled` and that `output.blockedTaints` includes both `SECRET` and `API_KEY`. Configured blocking still depends on enforcement mode and detectable labels. |
| Rule posture | Compare effective configured decisions against balanced defaults, including explicit overrides. More permissive decisions are listed by fixed policy field name. |
| Conversation records | Show retained records only. An empty history is an information state, not a failure. |
| Evidence retention | Distinguish memory-only recording from configured JSONL persistence without exposing its path. File writability is not tested. |

**Configured** means the checked setting is enabled or meets the stated baseline.
**Attention** means the setting reduces that part of protection; it may be intentional.
**Info** explains a boundary or unavailable comparison. There is no security score.

Settings changes belong in the profile's later `cordis.patch.yml` layer; restart that
profile afterwards. For example, if credential labels were removed unintentionally:

```yaml
- id: riskproof
  config:
    output:
      enabled: true
      blockedTaints: [SECRET, API_KEY]
```

Keep any other explicit configuration you still need when overriding the row. See
[configuration](configuration.md) for the complete reference. Selecting a stricter preset
alone does not undo explicit per-rule overrides.

## Boundaries

Checks read the resolved configuration and existing redacted record count. They do not
inspect private files, verify plugin origin, test the sandbox, probe network access or
certify a host version. `/riskproof demo` uses a separate synthetic balanced-policy
rehearsal and does not verify the current configuration. Actual-pipeline acceptance is
still needed for a deployment.

Paths, domain lists, trusted-declassifier names, tool arguments and result bodies are
excluded from check findings. Displayed command/tool reports enter normal DSH logs.
Web checks use the existing authenticated status RPC, follow the selected conversation,
and hide with other data while disconnected. Older snapshots without check data leave
this section hidden; missing comparison fields are described as unknown.

Recent risk cards also include a fixed, localized next step. These suggestions do not
authorize an operation or offer a model-controlled override. Use `/riskproof trace` to
review the rule, sources and receipt before changing configuration.

## 中文快速说明

`/riskproof doctor` 检查的是**当前已加载配置**，与 `/riskproof demo` 的隔离规则演练不同。
选择 `strict` 后若显式设置 `untrustedCodeExecution: allow`，仍会提示该有效规则比
balanced 默认值宽松。关闭输出门控或漏掉 `SECRET`／`API_KEY` 也会提示具体处理方法。

Web 点击浮标后展开“防护检查”即可查看；默认为折叠状态。修改配置后需要重启对应 profile。
“已配置”不代表绝对安全；检查不读取真实凭据、不验证宿主或沙箱，也不改变策略。
