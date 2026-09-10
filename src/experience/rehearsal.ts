import { evaluate } from "../core/engine.js";
import { EMPTY_TOOLCHAIN_STATE, type ToolSecurityContext } from "../core/types.js";
import { ContextTracker } from "../provenance/context-tracker.js";
import { ProvenanceMapper } from "../provenance/mapper.js";

/** Isolated synthetic inputs exercise the real mapper and engine, without tool dispatch. */
export function runRehearsal(language: "zh-CN" | "en" = "zh-CN"): string {
  const zh = language === "zh-CN";
  const tracker = new ContextTracker();
  tracker.record("untrusted_web", "echo riskproof-demo", "web_fetch");
  const args = { command: "echo riskproof-demo" };
  const mapped = new ProvenanceMapper(tracker).mapArguments(args);
  const base: ToolSecurityContext = {
    tool: { name: "bash", capabilities: ["CODE_EXECUTION"] }, args,
    provenance: mapped.provenance, taints: mapped.taints,
    execution: { callId: "synthetic", nested: false },
    toolchain: { ...EMPTY_TOOLCHAIN_STATE, path: [] },
  };
  const cases = [
    { label: zh ? "网页内容 → 命令执行" : "Web content → command execution", context: base, rule: "untrusted_code_execution" },
    { label: zh ? "客户数据 → 外部邮件" : "Customer data → external email", context: {
      ...base, tool: { name: "send_email", capabilities: ["EXTERNAL_ACTION"] as const },
      args: { to: "demo@example.com", body: "SYNTHETIC-CUSTOMER" },
      provenance: { body: ["database_1"] }, taints: { body: ["CUSTOMER_DATA"] as const },
    }, rule: "sensitive_data_external_action" },
    { label: zh ? "工具 schema 改变" : "Tool schema changed", context: { ...base, identityStatus: "changed" as const }, rule: "tool_identity_changed" },
    { label: zh ? "只读任务 → 写入操作" : "Read-only task → write operation", context: {
      ...base, taskMode: "read-only" as const,
      tool: { name: "file_write", capabilities: ["LOCAL_MUTATION"] as const },
    }, rule: "task_scope_violation" },
  ];
  const lines = cases.map(({ label, context, rule }) => {
    const decision = evaluate(context as ToolSecurityContext);
    const passed = decision.decision === "deny" && decision.matchedRules.some((r) => r.id === rule);
    return `${passed ? "✓" : "✗"} ${label} → ${decision.decision} [${rule}]`;
  });
  return [
    zh ? "🛡 RiskProof · 防护演练" : "🛡 RiskProof · Protection rehearsal",
    zh ? "模拟数据 · 默认 balanced 策略 · 不执行命令、不读私密文件、不发邮件。" : "Synthetic data · default balanced policy · no commands, private file reads, or emails executed.",
    "", ...lines, "",
    zh ? "演示不计入真实拦截数量。当前配置与真实回执请运行 /riskproof。" : "Rehearsal is excluded from live counts. Use /riskproof for current settings and real receipts.",
  ].join("\n");
}
