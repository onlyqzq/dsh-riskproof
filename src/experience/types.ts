import type { PolicyPreset } from "../config.js";
import type { SecurityProof, TaskMode, TaintLabel } from "../core/types.js";

/** Redacted runtime snapshot shared by text reports and the dashboard. */
export interface ReportSnapshot {
  mode: "observe" | "enforce";
  preset: PolicyPreset;
  language: "zh-CN" | "en";
  taskMode: TaskMode;
  proofEnabled: boolean;
  provenanceEnabled: boolean;
  taintEnabled: boolean;
  toolchainEnabled: boolean;
  outputEnabled: boolean;
  persistent: boolean;
  outputBlockedTaints?: TaintLabel[];
  /** Only fixed policy field names; no configured domains, paths or tool names. */
  relaxedPolicyRules?: string[];
  limit: number;
  proofs: SecurityProof[];
}
