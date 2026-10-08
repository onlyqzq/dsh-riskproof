import { POLICY_PRESETS } from "../config.js";
import type { ReportSnapshot } from "./types.js";

export interface ProtectionCheck {
  id: string;
  status: "ok" | "attention" | "info";
  title: string;
  detail: string;
  action?: string;
}

/** Configuration findings only: never a safety score or a host integrity claim. */
export interface ProtectionHealth {
  attention: number;
  checks: ProtectionCheck[];
  note: string;
}

/** No I/O, probes, dispatch, policy mutation or replay of private session content. */
export function protectionHealth(snapshot: ReportSnapshot): ProtectionHealth {
  const t = (cn: string, en: string) => snapshot.language === "en" ? en : cn;
  const checks: ProtectionCheck[] = [];
  const feature = (id: string, enabled: boolean, title: string, detail: string, action: string) => {
    checks.push({ id, status: enabled ? "ok" : "attention", title, detail: enabled
      ? t("已启用", "Enabled") : detail, ...(!enabled ? { action } : {}) });
  };
  feature("enforcement", snapshot.mode === "enforce", t("执行防护", "Execution protection"),
    t("当前仅观察：记录建议，不执行 RiskProof 拦截。", "Observe mode records recommendations without RiskProof blocking."),
    t("如需拦截，在 profile patch 中设置 mode: enforce 并重启。", "To block actions, set mode: enforce in the profile patch and restart."));
  feature("recording", snapshot.proofEnabled, t("执行证据", "Execution evidence"),
    t("记录已关闭，零条记录不代表没有调用。", "Recording is off; zero records does not mean no calls."),
    t("设置 proof.enabled: true 并重启。", "Set proof.enabled: true and restart."));
  feature("provenance", snapshot.provenanceEnabled, t("来源匹配", "Provenance matching"),
    t("无法匹配工具参数的已记录来源。", "Recorded origins cannot be matched to tool arguments."),
    t("设置 provenance.enabled: true 并重启。", "Set provenance.enabled: true and restart."));
  feature("taint", snapshot.taintEnabled, t("敏感标签传播", "Sensitive label propagation"),
    t("参数侧敏感标签分析已关闭。", "Argument-side sensitive label analysis is disabled."),
    t("设置 taint.enabled: true 并重启。", "Set taint.enabled: true and restart."));
  feature("toolchain", snapshot.toolchainEnabled, t("跨工具链检测", "Cross-tool chain detection"),
    t("跨调用攻击链检测已关闭。", "Cross-call attack-chain detection is disabled."),
    t("设置 toolchain.enabled: true 并重启。", "Set toolchain.enabled: true and restart."));

  const missing = snapshot.outputBlockedTaints === undefined ? undefined
    : ["SECRET", "API_KEY"].filter(label => !snapshot.outputBlockedTaints!.includes(label as "SECRET" | "API_KEY"));
  checks.push({
    id: "credential-output",
    status: !snapshot.outputEnabled || missing?.length ? "attention" : missing === undefined ? "info" : "ok",
    title: t("凭据输出保护", "Credential output protection"),
    detail: !snapshot.outputEnabled ? t("输出门控已关闭。", "Output gating is disabled.")
      : missing === undefined ? t("此快照未提供阻止标签，无法核对凭据覆盖。", "This snapshot does not report blocked labels; credential coverage is unknown.")
        : missing.length ? t(`未阻止默认凭据标签：${missing.join(", ")}。`, `Default credential labels are not blocked: ${missing.join(", ")}.`)
          : t("已配置阻止 SECRET 和 API_KEY 输出；实际拦截还取决于执行模式和可检测标签。", "SECRET and API_KEY output blocking is configured; enforcement still depends on mode and detectable labels."),
    ...(!snapshot.outputEnabled || missing?.length ? { action: t(
      "检查 output.enabled 与 output.blockedTaints，保留 SECRET、API_KEY 后重启。",
      "Review output.enabled and output.blockedTaints; include SECRET and API_KEY, then restart.") } : {}),
  });
  const relaxed = snapshot.relaxedPolicyRules?.filter(field => Object.hasOwn(POLICY_PRESETS.balanced, field));
  checks.push({
    id: "policy-posture", status: relaxed?.length ? "attention" : relaxed === undefined ? "info" : "ok",
    title: t(`规则强度（${snapshot.preset}）`, `Rule posture (${snapshot.preset})`),
    detail: relaxed === undefined ? t("此快照未提供有效规则比较结果。", "Effective rule comparison is unavailable in this snapshot.")
      : relaxed.length ? t(`${relaxed.length} 项有效规则比 balanced 默认值宽松：${relaxed.join(", ")}。`, `${relaxed.length} effective rules are more permissive than balanced defaults: ${relaxed.join(", ")}.`)
        : t("受检规则均未比 balanced 默认值放宽；不代表覆盖所有风险。", "Checked rules are no more permissive than balanced defaults; this does not cover every risk."),
    ...(relaxed?.length ? { action: t("核对 policy 中的预设与单项覆盖；更改预设后仍需检查显式覆盖。", "Review the policy preset and explicit overrides; changing a preset does not remove explicit overrides.") } : {}),
  });
  checks.push({ id: "activity", status: "info", title: t("当前会话记录", "Conversation records"),
    detail: !snapshot.proofEnabled ? t("记录已关闭，无法判断工具活动。", "Recording is disabled; tool activity cannot be inferred.")
      : snapshot.proofs.length ? t(`本次运行保留 ${snapshot.proofs.length} 条；不代表完整历史。`, `${snapshot.proofs.length} records retained in this run; these are not the full history.`)
        : t("尚无保留记录；可以运行 /riskproof demo 了解规则，演练不会验证当前配置。", "No retained records yet. Try /riskproof demo to learn the rules; rehearsals do not verify current configuration.") });
  checks.push({ id: "retention", status: "info", title: t("证据保存方式", "Evidence retention"),
    detail: snapshot.persistent ? t("已配置 JSONL 持久化；此检查未验证文件可写性。", "JSONL persistence is configured; this check does not verify file writability.")
      : t("仅在内存保存；重启后不恢复记录。", "Memory only; records are not restored after restart.") });
  return {
    attention: checks.filter(check => check.status === "attention").length,
    checks,
    note: t("只读配置检查，不执行工具、不读取私密文件；不替代宿主兼容性、沙箱或安全审计。",
      "Read-only configuration checks; no tool execution or private file reads. Not a host compatibility, sandbox or security audit."),
  };
}

export function renderHealthReport(snapshot: ReportSnapshot): string {
  const health = protectionHealth(snapshot);
  const zh = snapshot.language !== "en";
  const labels = zh ? { ok: "已配置", attention: "需关注", info: "说明" }
    : { ok: "Configured", attention: "Attention", info: "Info" };
  return [
    zh ? "🛡 RiskProof · 防护检查" : "🛡 RiskProof · Protection checks",
    zh ? `${health.attention} 项配置需关注` : `${health.attention} configuration checks need attention`,
    "",
    ...health.checks.flatMap(check => [
      `[${labels[check.status]}] ${check.title}: ${check.detail}`,
      ...(check.action ? [`  ${zh ? "建议" : "Next"}: ${check.action}`] : []),
    ]),
    "", health.note,
  ].join("\n");
}
