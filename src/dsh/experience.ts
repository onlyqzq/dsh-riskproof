import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-commands";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { TaskMode } from "../core/types.js";
import type { RiskProofRuntime } from "./runtime.js";
import { renderReport } from "../experience/report.js";
import { runRehearsal } from "../experience/rehearsal.js";

const HELP = [
  "🛡 RiskProof · 安全中心 / Security center",
  "/riskproof — 当前会话安全账单 / session receipt",
  "/riskproof trace — 最近 10 次调用的来源、标签与执行回执 / provenance timeline",
  "/riskproof demo — 无副作用防护演练 / isolated rehearsal",
  "/riskproof task read-only — 只读：阻止写入、外发、shell 和未知工具",
  "/riskproof task local-only — 本地：阻止网络工具、shell 和未知工具",
  "/riskproof task standard — 恢复常规任务范围；基础安全规则仍然生效",
  "任务约束仅针对可观测工具能力，不替代 OS 沙箱；新会话恢复配置默认值。",
  "Task contracts check observable capabilities, not OS isolation; new sessions use configured defaults.",
  "自然语言入口 / Natural language: 请调用 riskproof_report 展示本次会话安全报告。",
].join("\n");

export function installExperience(ctx: Context, runtime: RiskProofRuntime): void {
  ctx.tools.register(defineTool({
    name: "riskproof_report",
    description: "Show RiskProof security status, provenance timeline, execution receipts, or a harmless synthetic demo for this session. Read-only; cannot change policy or task scope. 安全报告、溯源与防护演练。",
    parameters: {
      view: { type: "string", enum: ["status", "trace", "demo"], description: "Report view; defaults to status" },
    },
    output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
    presentCall: () => ({ card: "generic", title: "🛡 RiskProof · 安全报告 / Security report", kind: "read" }),
    async execute(args, exec) {
      const snapshot = runtime.report(exec.agent?.id);
      return args.view === "demo" ? runRehearsal(snapshot.language)
        : renderReport(snapshot, args.view === "trace" ? "trace" : "status");
    },
  }));
  runtime.markDiagnostic("riskproof_report");

  // Commands are optional: minimal/headless profiles retain the report tool.
  ctx.inject(["commands"], (inner) => {
    inner.commands.register({
      name: "riskproof",
      description: "🛡 安全账单、数据溯源、防护演练 / Security receipt & provenance",
      input: { hint: "trace | demo | task read-only | task local-only | task standard | help" },
      recordInput: false,
      handler: ({ agent, rawInput }) => {
        const input = rawInput.trim();
        if (input === "help") return { kind: "success", text: HELP };
        const snapshot = runtime.report(agent.id);
        if (input === "demo") return { kind: "success", text: runRehearsal(snapshot.language) };
        if (input.startsWith("task ")) {
          const mode = input.slice(5).trim();
          if (!["standard", "read-only", "local-only"].includes(mode)) return { kind: "error", text: HELP };
          runtime.setTaskMode(agent.id, mode as TaskMode);
          return { kind: "success", text: renderReport(runtime.report(agent.id)) };
        }
        if (!["", "status", "trace"].includes(input)) return { kind: "error", text: HELP };
        return { kind: "success", text: renderReport(snapshot, input === "trace" ? "trace" : "status") };
      },
    });
  });
  ctx.logger("riskproof").info("🛡 RiskProof ready · /riskproof · /riskproof demo · riskproof_report");
}
