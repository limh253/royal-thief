import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (script, args, input) => spawnSync(process.execPath, [path.join(root, script), ...args], {
  input,
  encoding: 'utf8',
  timeout: 120000,
});

test('热座 CLI：脚本化输入可以跑完一整局并给出终局结果', () => {
  const input = `${Array.from({ length: 200 }, () => 'n').join('\n')}\n`;
  const res = run('cli/hotseat.js', ['7'], input);
  assert.equal(res.status, 0, `退出码 ${res.status}\n${res.stderr}`);
  assert.match(res.stdout, /结果：(A 胜|B 胜|平局)/);
  assert.match(res.stdout, /A 手牌：/);
  assert.match(res.stdout, /B 手牌：/);
  assert.equal(res.stdout.includes('Error'), false);
});

test('热座 CLI：输入提前结束时不崩溃，正常退出', () => {
  const res = run('cli/hotseat.js', ['7'], '\n');
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /输入已结束/);
});

test('回放 CLI：固定种子输出可复现的终局', () => {
  const a = run('cli/simulate.js', ['--seed=1'], '');
  const b = run('cli/simulate.js', ['--seed=1'], '');
  assert.equal(a.status, 0, a.stderr);
  assert.equal(a.stdout, b.stdout, '同种子两次回放必须完全一致');
  assert.match(a.stdout, /结果：/);
});

test('批量统计 CLI：输出终局原因分布与先后手胜负', () => {
  const res = run('cli/simulate.js', ['--games=20'], '');
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /手牌归零|僵局兜底|止戈|回合上限|平局/);
  assert.match(res.stdout, /A 胜 \d+ \/ B 胜 \d+/);
});