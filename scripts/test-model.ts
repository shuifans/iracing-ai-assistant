/**
 * 最小可用性测试：验证 QODER_MODEL 配置的模型是否能正常响应
 * 用法：npx tsx scripts/test-model.ts
 */
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { query, accessTokenFromEnv } from '@qoder-ai/qoder-agent-sdk';

// 手动加载 .env（项目未安装 dotenv）
const envPath = resolve(__dirname, '..', '.env');
const envContent = readFileSync(envPath, 'utf-8');
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx);
  const val = trimmed.slice(eqIdx + 1);
  if (!process.env[key]) process.env[key] = val;
}

const model = process.env.QODER_MODEL ?? 'qmodel';
console.log(`[test] 测试模型: ${model}`);
console.log(`[test] PAT: ${process.env.QODER_PERSONAL_ACCESS_TOKEN?.slice(0, 12)}...`);

async function main() {
  const startTime = Date.now();

  // Windows 上 qodercli.cmd 会导致 EINVAL，直接指向 JS bundle
  const cliPath =
    process.platform === 'win32'
      ? [
          join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@qoder-ai', 'qodercli', 'bundle', 'qodercli.js'),
        ].find(existsSync)
      : undefined;
  console.log(`[test] CLI path: ${cliPath ?? '(default)'}`);

  const q = query({
    prompt: 'Say exactly: "Model is working." Nothing else.',
    options: {
      auth: accessTokenFromEnv(),
      model,
      maxTurns: 2,
      ...(cliPath ? { pathToQoderCLIExecutable: cliPath } : {}),
      disallowedTools: ['Write', 'Edit', 'Bash', 'Agent', 'WebFetch', 'WebSearch'],
    },
  });

  let gotResponse = false;

  for await (const msg of q) {
    if (msg.type === 'stream_event') {
      const event = msg.event;
      if (event.type === 'content_block_delta') {
        const delta = event.delta as { text?: string } | undefined;
        if (delta?.text) {
          process.stdout.write(delta.text);
          gotResponse = true;
        }
      }
    }

    // 有些模型不输出 stream_event，文本在 assistant 消息中
    if (msg.type === 'assistant') {
      const assistantMsg = msg.message as { content?: Array<{ type: string; text?: string }> };
      for (const block of assistantMsg.content ?? []) {
        if (block.type === 'text' && block.text) {
          process.stdout.write(block.text);
          gotResponse = true;
        }
      }
    }

    if (msg.type === 'result') {
      console.log('\n');
      if (msg.subtype === 'success') {
        const elapsed = Date.now() - startTime;
        console.log(`[test] ✓ 成功 | 耗时: ${elapsed}ms`);
        console.log(`[test]   input_tokens:  ${msg.usage.input_tokens}`);
        console.log(`[test]   output_tokens: ${msg.usage.output_tokens}`);
        if (msg.total_cost_usd !== undefined) {
          console.log(`[test]   total_cost:    $${msg.total_cost_usd.toFixed(6)}`);
        }
      } else {
        console.log(`[test] ✗ 失败 | subtype: ${msg.subtype}`);
        if ('errors' in msg) console.log(`[test]   errors:`, msg.errors);
      }
    }
  }

  if (!gotResponse) {
    console.log('[test] ✗ 未收到任何文本响应');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[test] ✗ 异常:', err);
  process.exit(1);
});
