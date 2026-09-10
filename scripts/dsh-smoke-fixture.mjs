// Loaded ONLY by check:dsh in an isolated profile. No file/network tool bodies.
export const name = "riskproof-install-fixture";
export const inject = ["tools", "commands", "sessions"];

export async function apply(ctx) {
  const session = ctx.sessions.create();
  const agent = { id: "riskproof-install-check", session };
  const deadline = Date.now() + 5000;
  while (!ctx.tools.get("riskproof_report") || !ctx.commands.find(agent, "riskproof")) {
    if (Date.now() > deadline) throw new Error("RiskProof command/report registration missing");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const command = async (input) => {
    const signal = new AbortController().signal;
    const result = ctx.commands.execute.length >= 4
      ? await ctx.commands.execute(agent, `/riskproof ${input}`, [], signal)
      : await ctx.commands.execute(agent, `/riskproof ${input}`, signal);
    if (result?.result.kind !== "success") throw new Error(`RiskProof command failed: ${input}`);
    return result.result.text ?? "";
  };
  const demo = await command("demo");
  if (demo.includes("✗") || (demo.match(/✓/g) ?? []).length !== 4) throw new Error("Rehearsal failed");
  await command("task read-only");
  let executed = false;
  ctx.tools.register({
    name: "riskproof_smoke_file_write", description: "Write a local file", parameters: { type: "object", properties: {} },
    output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
    async execute() { executed = true; return "synthetic"; },
  });
  const call = (name) => ctx.tools.execute({ name, arguments: {}, agent,
    callId: `smoke-${name}`, signal: new AbortController().signal });
  const blocked = await call("riskproof_smoke_file_write");
  if (!blocked.isError || executed) throw new Error("Read-only task did not stop the tool body");
  const report = await call("riskproof_report");
  if (report.isError || !String(report.value).includes("RiskProof 已拦截 1")) throw new Error("Installed report receipt failed");
  const trace = await command("trace");
  if (!trace.includes("deny → blocked")) throw new Error("Installed trace missing execution receipt");
  process.stderr.write("RISKPROOF_INSTALL_CHECK_OK\n" + demo + "\n" + trace + "\n");
}
