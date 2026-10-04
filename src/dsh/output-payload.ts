import type { PostToolDecision, ToolExecutionResult } from "@deepseek-ai/dsh-tools";

/** Model-facing projections inspected by output information-flow control. */
export function outputPayload(result: Readonly<ToolExecutionResult>): unknown[] {
  return result.isError
    ? [result.content, result.additionalContexts]
    : [result.value, result.content, result.additionalContexts];
}

export function postDecisionPayload(
  result: Readonly<ToolExecutionResult>,
  decision: Extract<PostToolDecision, { kind: "accept" }>,
): unknown[] {
  const hasValue = Object.hasOwn(decision, "value");
  const hasContent = Object.hasOwn(decision, "content");
  const hasContexts = Object.hasOwn(decision, "additionalContexts");
  if (!hasValue && !hasContent) {
    return [...outputPayload(result), ...(hasContexts ? [decision.additionalContexts] : [])];
  }
  // A content-only replacement does not replace the canonical success value;
  // keep evaluating it because Code Mode and the result observer can still
  // consume that value even when Native model content was sanitized.
  if (hasContent) {
    return [
      ...(!result.isError ? [result.value] : []),
      decision.content,
      ...(hasContexts ? [decision.additionalContexts] : []),
    ];
  }
  return [
    ...(hasValue ? [decision.value] : []),
    ...(hasContexts ? [decision.additionalContexts] : []),
  ];
}
