import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installDom, el, sleep } from './dom-shim.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

test('单文件版：无外部依赖、无模块语法残留，且能初始化牌桌', async () => {
  execFileSync(process.execPath, [path.join(root, 'tools/build-single.mjs')], { cwd: root });
  const html = readFileSync(path.join(root, 'dist', '王权窃贼.html'), 'utf8');
  assert.equal(html.includes('src="./app.js"'), false, '不应再引用外部 app.js');
  assert.equal(html.includes('./styles.css'), false, '不应再引用外部样式');
  assert.match(html, /<style>/);

  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(m, '应存在内联脚本');
  const js = m[1];
  assert.equal(/(^|\n)\s*(import|export)\s/.test(js), false, '不得残留 import/export');
  assert.equal(js.includes('__SINGLE_FILE__'), true, '应标记为单文件版（跳过 file:// 警告）');

  const tmp = path.join(os.tmpdir(), `rt_bundle_${process.pid}.mjs`);
  writeFileSync(tmp, js, 'utf8');
  const { el: E } = installDom();
  await import(pathToFileURL(tmp).href);
  await sleep(30);
  assert.match(E('handA').innerHTML, /class="card/, '单文件版应渲染出玩家手牌');
  assert.match(E('handB').innerHTML, /card back/, '对手手牌应为背面');
  assert.match(E('prompt').innerHTML, /功能牌阶段|不打出功能牌|没有功能牌/);
  assert.match(E('phasebar').innerHTML, /抽牌/);
});

test('手游版单文件：内联 mobile.css / mobile.js，且能初始化牌桌', async () => {
  execFileSync(process.execPath, [path.join(root, 'tools/build-single.mjs')], { cwd: root });
  const html = readFileSync(path.join(root, 'dist', '王权窃贼-手游.html'), 'utf8');
  assert.equal(/src="\/web\//.test(html), false, '不得引用外部脚本');
  assert.equal(/href="\/web\//.test(html), false, '不得引用外部样式');
  assert.match(html, /viewport-fit=cover/, '手游版要有安全区 viewport');
  assert.match(html, /--safe-t/, 'mobile.css 应已内联');
  assert.match(html, /__RT_MOBILE_TIP__/, 'mobile.js 应已内联');
  assert.match(html, /href=".\/王权窃贼.html"/, '手游版里的「端游版」链接要指向同目录单文件');

  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(m, '应存在内联脚本');
  assert.equal(/(^|\n)\s*(import|export)\s/.test(m[1]), false, '不得残留 import/export');

  const tmp = path.join(os.tmpdir(), `rt_bundle_mobile_${process.pid}.mjs`);
  writeFileSync(tmp, m[1], 'utf8');
  const { el: E } = installDom();
  await import(pathToFileURL(tmp).href);
  await sleep(30);
  assert.match(E('handA').innerHTML, /class="card/, '手游版应渲染出玩家手牌');
  assert.match(E('handB').innerHTML, /card back/, '对手手牌应为背面');
  assert.match(E('prompt').innerHTML, /功能牌阶段|不打出功能牌|没有功能牌/);
  assert.equal(E('fatal').innerHTML, '', '手游版不得报错');
});
