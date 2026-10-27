#!/usr/bin/env node
import { renderRehearsal, runRehearsalResults } from "./experience/rehearsal.js";

interface DemoOutput {
  write(text: string): void;
  error(text: string): void;
}

const USAGE = [
  "RiskProof · synthetic protection rehearsal / 模拟防护演练",
  "Usage: riskproof-demo [--language zh-CN|en] [--json] [--help]",
  "",
  "Requires Node.js 22.19+. No DSH profile or model API key is needed.",
  "需要 Node.js 22.19+；无需 DSH profile 或模型 API key。",
  "The installed demo runs locally with synthetic data and default balanced policy.",
  "安装后的演练仅在本地使用模拟数据与默认 balanced 策略。",
  "It does not inspect your configuration or verify a live DSH installation.",
  "演练不读取你的配置，也不验证真实 DSH 安装状态。",
].join("\n");

/** No host boot, network requests, shell dispatch or user-file reads. */
export function runDemoCli(args: readonly string[], output: DemoOutput = {
  write: (text) => process.stdout.write(text),
  error: (text) => process.stderr.write(text),
}): number {
  let language: "zh-CN" | "en" = "zh-CN";
  let json = false;
  let help = false;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (seen.has(option) || !["--language", "--json", "--help"].includes(option)) {
      output.error("Invalid options / 参数无效。Use riskproof-demo --help.\n");
      return 2;
    }
    seen.add(option);
    if (option === "--language") {
      const value = args[++i];
      if (value !== "zh-CN" && value !== "en") {
        output.error("Invalid language / 语言参数无效。Use --language zh-CN or --language en.\n");
        return 2;
      }
      language = value;
    } else if (option === "--json") json = true;
    else help = true;
  }
  if (help) {
    output.write(`${USAGE}\n`);
    return 0;
  }
  try {
    const results = runRehearsalResults(language);
    if (json) output.write(`${JSON.stringify(results, null, 2)}\n`);
    else {
      const next = language === "en"
        ? "Next: install into DSH (requires DSH and pnpm), restart Web, then run /riskproof doctor and /riskproof demo."
        : "下一步：安装到 DSH（需先安装 DSH 和 pnpm），重启 Web，再运行 /riskproof doctor 和 /riskproof demo。";
      output.write(`${renderRehearsal(results)}\n\n${next}\ndsh plugin --profile web add dsh-riskproof\n`);
    }
    return results.passed ? 0 : 1;
  } catch {
    output.error("Rehearsal could not complete / 演练未能完成。\n");
    return 1;
  }
}

if (import.meta.main) process.exitCode = runDemoCli(process.argv.slice(2));
