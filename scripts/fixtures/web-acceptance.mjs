// Test-only local adapter: exercises the real Agent loop and UI without API calls.
// Loaded only by the isolated Web acceptance profile; never packaged in npm.
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { appendFileSync } from 'node:fs';
export const name = 'riskproof-web-acceptance-fixture';
export const inject = ['llm', 'tools', 'workspaceController'];
const provider = 'riskproof-local-test';
const model = { provider, id: 'deterministic', name: 'RiskProof 本地验收（模拟模型）', context: { contextWindow: 128000 } };
let sequence = 0;
class LocalTestAdapter extends LlmAdapter {
  providerInfo() { return { id: provider, name: 'RiskProof 本地验收' }; }
  async listModels() { return [model]; }
  async resolveModel() { return model; }
  async *stream(options) {
    if (options.signal?.aborted) throw options.signal.reason;
    const userIndex = options.messages.findLastIndex(message => message.source?.kind === 'user');
    const last = options.messages[userIndex];
    const text = last?.content?.filter(b => b.type === 'text').map(b => b.text).join(' ') ?? '';
    const hasResult = options.messages.slice(userIndex + 1).some(message => message.content.some(b => b.type === 'tool-result'));
    let call;
    if (!hasResult && text.includes('查看报告')) call = ['riskproof_report', { view: 'trace' }];
    if (!hasResult && text.includes('网页读取测试')) call = ['riskproof_acceptance_web_fetch', {}];
    if (!hasResult && text.includes('来源命令测试')) call = ['riskproof_acceptance_bash', { command: 'echo RISKPROOF_WEB_FIXTURE' }];
    if (!hasResult && text.includes('只读写入测试')) call = ['riskproof_acceptance_file_write', { path: 'riskproof-web-acceptance.txt' }];
    const block = call ? { type: 'tool-call', id: `web-acceptance-${++sequence}`, name: call[0], arguments: JSON.stringify(call[1]) }
      : { type: 'text', text: '本地验收步骤完成。以上为模拟模型驱动的真实 DSH 工具管线，未调用外部模型。' };
    yield { type: 'block-start', index: 0, blockType: block.type };
    if (call) yield { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments };
    else yield { type: 'text-delta', index: 0, text: block.text };
    yield { type: 'block-end', index: 0, block };
    yield { type: 'finish', reason: { kind: call ? 'tool-calls' : 'stop' } };
  }
}
export async function apply(ctx) {
  ctx.llm.registerAdapter([provider], new LocalTestAdapter());
  await ctx.workspaceController.create({ path: process.env.RISKPROOF_WEB_WORKSPACE });
  const register = (name, description, parameters, value, sideEffect) => ctx.tools.register(defineTool({
    name, description, parameters,
    output: { schema: { type: 'string' }, render: (_args, v) => [{ type: 'text', text: v }] },
    async execute() {
      if (name === "riskproof_acceptance_web_fetch") await new Promise(resolve => setTimeout(resolve, 2200));
      if (sideEffect) appendFileSync(process.env.RISKPROOF_WEB_BODY_MARKER, name + '\n');
      return value;
    },
  }));
  register('riskproof_acceptance_web_fetch', 'Fetch untrusted web text (synthetic acceptance fixture)', {}, 'echo RISKPROOF_WEB_FIXTURE', false);
  register('riskproof_acceptance_bash', 'Execute a shell command (synthetic acceptance fixture)', { command: { type: 'string', required: true } }, 'unexpected execution', true);
  register('riskproof_acceptance_file_write', 'Write a local file (synthetic acceptance fixture)', { path: { type: 'string', required: true } }, 'unexpected execution', true);
}
