// 联机端到端测试：用一个无头 Edge 开两个页面，一个开房、一个拿邀请码进房，
// 然后两边互相出手打到终局，顺便断言“对手信息不泄露”。不依赖任何 npm 包。
//
// 用法：
//   1) 先 node server.mjs（另一个窗口）
//   2) node tools/e2e-online.mjs
//      node tools/e2e-online.mjs http://192.168.1.9:8787/web/mobile.html   # 手机版
//   截图与进度日志写在临时目录（结束时会打印路径）。
//   中途卡住会自动导出两页现场（DOM + 快照送达轨迹），方便定位。

import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 9391;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.argv[2] || 'http://localhost:8787/web/index.html';
const API = new URL(BASE).origin;
const OUT = path.join(os.tmpdir(), 'rt_online_e2e');
fs.mkdirSync(OUT, { recursive: true });
const userDataDir = path.join(os.tmpdir(), 'rt_edge_online_' + Date.now());
const edge = spawn(EDGE, ['--headless=new', '--no-sandbox', '--in-process-gpu', '--disable-gpu', '--no-first-run',
  '--disable-extensions', '--no-default-browser-check', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--window-size=1440,1000', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`, 'about:blank'],
  { stdio: 'ignore', windowsHide: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOGF = path.join(OUT, "progress.log");
fs.writeFileSync(LOGF, "");
const log = (...a) => { const t = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "); try { fs.appendFileSync(LOGF, t + "\n"); } catch { /* ignore */ } console.log(t); };
setTimeout(() => { log("WATCHDOG: 5 分钟兜底退出"); process.exit(9); }, 300000);
const openWs = (url) => new Promise((res, rej) => {
  const w = new WebSocket(url);
  const tm = setTimeout(() => rej(new Error("ws open timeout: " + url)), 15000);
  w.addEventListener("open", () => { clearTimeout(tm); res(w); }, { once: true });
  w.addEventListener("error", (e) => { clearTimeout(tm); rej(e); }, { once: true });
});

async function listTargets() {
  for (const h of ['127.0.0.1', 'localhost']) {
    try { return await (await fetch(`http://${h}:${PORT}/json/list`)).json(); } catch { /* next */ }
  }
  return null;
}
async function waitDevtools() {
  for (let i = 0; i < 90; i++) { const l = await listTargets(); if (l && l.some((t) => t.type === 'page')) return l; await sleep(250); }
  throw new Error('DevTools 未就绪');
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
        if (m.error) reject(new Error(JSON.stringify(m.error))); else resolve(m.result); return;
      }
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') this.errors.push(m.params.entry.text + ' @ ' + (m.params.entry.url ?? '-'));
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('CDP timeout ' + method)); } }, 30000);
    });
  }
  async eval(x) {
    const r = await this.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page error: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result.value;
  }
  async shot(n) { const r = await this.send('Page.captureScreenshot', { format: 'png' }); const f = path.join(OUT, n + '.png'); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); return f; }
  async ready(name) {
    await this.send('Page.enable'); await this.send('Runtime.enable'); await this.send('Log.enable');
    await this.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await this.send('Page.navigate', { url: name });
    for (let i = 0; i < 80; i++) { await sleep(250); try { if (await this.eval('Boolean(globalThis.__RT_BOOTED__)')) return true; } catch { /* retry */ } }
    throw new Error('page not booted: ' + name);
  }
}

const targets = await waitDevtools();
log("devtools 就绪");
const first = targets.find((t) => t.type === 'page');
const p1 = new CDP(await openWs(first.webSocketDebuggerUrl));
log("page1 ws 连上");

// 第二个页面（模拟另一台设备）
const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const bws = await openWs(ver.webSocketDebuggerUrl);
log("browser ws 连上");
let bSeq = 0;
const bsend = (method, params) => new Promise((res, rej) => { const id = ++bSeq + 100; const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { bws.removeEventListener('message', h); if (m.error) rej(new Error(JSON.stringify(m.error))); else res(m.result); } }; bws.addEventListener('message', h); bws.send(JSON.stringify({ id, method, params })); });
let t2 = null;
try {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
  if (r.ok) t2 = await r.json();
} catch (e) { log("PUT /json/new 失败: " + e.message); }
if (!t2?.webSocketDebuggerUrl) {
  const created = await bsend('Target.createTarget', { url: 'about:blank' });
  for (let i = 0; i < 40; i++) { const l = await listTargets(); t2 = l.find((t) => t.targetId === created.targetId || t.id === created.targetId); if (t2?.webSocketDebuggerUrl) break; await sleep(200); }
}
if (!t2?.webSocketDebuggerUrl) throw new Error('second page 没起来');
log("第二个标签页就绪");
const p2 = new CDP(await openWs(t2.webSocketDebuggerUrl));
log("page2 ws 连上");

const fails = [];
const check = (cond, msg) => { log((cond ? 'PASS  ' : 'FAIL  ') + msg); if (!cond) fails.push(msg); };

await p1.ready(BASE);
log("page1 启动完成");
await sleep(600);

// ---------- 1) 创建房间 ----------
await p1.eval(`document.querySelector('[data-act="online-create"]').click()`);
let code = null;
for (let i = 0; i < 60; i++) {
  await sleep(250);
  const t = await p1.eval(`document.getElementById('seed').textContent.trim()`);
  if (/^[A-Z2-9]{4}$/.test(t)) { code = t; break; }
}
check(Boolean(code), '创建房间拿到 4 位邀请码: ' + code);
if (!code) { log('abort'); process.exit(1); }
await sleep(1200);
log('  page1 seat:', await p1.eval(`document.getElementById('nameA').textContent + ' / ' + document.getElementById('nameB').textContent`));
const seat1 = await p1.eval(`document.getElementById('nameA').textContent + '|' + document.getElementById('nameB').textContent`);
check(seat1.includes('A\uFF08\u4F60\uFF09'), 'page1 坐的是玩家 A（实际 ' + seat1 + '）');
const shot1 = await p1.shot('01-p1-wait');

// ---------- 2) 第二个页面用 ?room=CODE 进去 ----------
await p2.ready(BASE + '?room=' + code);
log("page2 启动完成");
let joined = false;
for (let i = 0; i < 80; i++) {
  await sleep(300);
  const names = await p2.eval(`document.getElementById('nameA').textContent + '|' + document.getElementById('nameB').textContent`);
  if (names.includes('\uFF08\u4F60\uFF09')) { joined = true; log('  page2 seat:', names); break; }
}
check(joined, 'page2 用邀请码 ?room=' + code + ' 进了房间');
const seat2 = await p2.eval(`document.getElementById('nameA').textContent + '|' + document.getElementById('nameB').textContent`);
check(seat2.includes('B\uFF08\u4F60\uFF09'), 'page2 坐的是玩家 B（没抢 page1 的座位）（实际 ' + seat2 + '）');
const seat1b = await p1.eval(`document.getElementById('nameA').textContent`);
check(seat1b.includes('A\uFF08\u4F60\uFF09'), 'page2 进来后 page1 仍是玩家 A（实际 ' + seat1b + '）');

// 双方都该看到「对手到齐」
const tok1 = await p1.eval(`sessionStorage.getItem('rt-room-' + '${code}')`);
check(Boolean(tok1), 'page1 的 sessionStorage 里存了自己的房间凭证');
const srv = await (await fetch(API + '/api/room/state?code=' + code + '&token=' + tok1)).json();
check(Boolean(srv.seats?.A && srv.seats?.B), '服务器确认房间满员：A / B 都就座');
check(srv.you === 'A', '凭证换回来的是玩家 A 的座位（实际 ' + srv.you + '）');
await sleep(800);

// ---------- 3) 信息不泄漏 ----------
const ids = (page, sel) => page.eval(`[...document.querySelectorAll('${sel} [data-card]')].map(e => e.getAttribute('data-card'))`);
const h1 = await ids(p1, '#handA'); const h1b = await ids(p1, '#handB');
const h2 = await ids(p2, '#handB'); const h2b = await ids(p2, '#handA');
log('  page1 自己手牌:', JSON.stringify(h1), ' 对手(背面)张数元素:', h1b.length);
log('  page2 自己手牌:', JSON.stringify(h2), ' 对手(背面)张数元素:', h2b.length);
check(h1.length >= 4 && h2.length >= 4, '双方各自看得到自己手牌: ' + h1.length + '/' + h2.length);
check(h1b.length === 0 && h2b.length === 0, '对手手牌只有背面、不给 data-card');

const html1 = await p1.eval(`document.documentElement.outerHTML`);
const html2 = await p2.eval(`document.documentElement.outerHTML`);
check(h2.every((id) => !html1.includes('data-card="' + id + '"')), 'page1 的页面里没有 page2 的手牌 id');
check(h1.every((id) => !html2.includes('data-card="' + id + '"')), 'page2 的页面里没有 page1 的手牌 id');
const cnt = await p1.eval(`document.getElementById('countB').textContent + '|' + document.getElementById('countA').textContent`);
check(cnt.split('|')[0] === '?' && cnt.split('|')[1] === String(h1.length), '对手张数显示 ? 、自己显示真实张数（实际: ' + cnt + '）');
check(!html1.includes('\u79CD\u5B50'), '页面里不含「种子」字样');
const stateLeak = await p1.eval(`(() => { const s = document.getElementById('seed').textContent; return s; })()`);
check(stateLeak === code, '种子位置显示的是邀请码（实际 ' + stateLeak + '）');

// ---------- 4) 打到终局 ----------
const DRIVE = `(() => {
  const $ = (id) => document.getElementById(id);
  const ov = $('overlay');
  if (ov && !ov.classList.contains('hidden')) {
    if (ov.querySelector('[data-act="online-rematch"]')) return 'gameover';
    const rd = ov.querySelector('[data-act="ready"]'); if (rd) { rd.click(); return 'ready'; }
    return 'overlay';
  }
  const arena = $('arena'); if (arena) arena.click();
  const p = $('prompt'); if (!p) return 'no-prompt';
  const q = (s) => p.querySelector(s);
  // 出牌一律直接点手牌（只有自己的手牌会渲染出 data-card）
  const h = (s) => document.querySelector('#handA ' + s + ', #handB ' + s);
  const cg = q('[data-act="cancel-give"]'); if (cg) { cg.click(); return 'cancel-give'; }
  const gv = h('[data-give]'); if (gv) { gv.click(); return 'give'; }
  const person = h('[data-person]');
  if (person) {
    person.click();
    const it = h('[data-item]'); if (it) it.click();
    const f = q('[data-act="fight"]'); if (f && !f.disabled) { f.click(); return 'fight'; }
    return 'selected';
  }
  const pd = q('[data-act="pass-declare"]'); if (pd) { pd.click(); return 'pass-declare'; }
  const ps = q('[data-act="pass"]'); if (ps) { ps.click(); return 'pass'; }
  const pl = h('[data-play]'); if (pl) { pl.click(); return 'play-fn'; }
  const rw = q('[data-act="reward-ok"]');
  if (rw) {
    const r = document.querySelector('#slotA [data-reward], #slotB [data-reward]'); if (r) r.click();
    const ok = q('[data-act="reward-ok"]'); if (ok && !ok.disabled) { ok.click(); return 'reward'; }
    return 'reward-wait';
  }
  return 'idle';
})()`;

const DUMP = `(async () => {
  const $ = (id) => document.getElementById(id);
  const t = (id) => (($(id)?.textContent ?? '')).trim().slice(0, 200);
  const ov = $('overlay');
  return {
    overlay: (ov && !ov.classList.contains('hidden')) ? (($('ovcard').textContent ?? '').trim().slice(0, 90)) : "hidden",
    phasebar: t('phasebar'), turnbar: t('turnbar'), verdict: t('verdict'),
    prompt: ($('prompt')?.innerHTML ?? "").slice(0, 300),
    deck: t('deckCount'), discard: t('discardCount'),
    countA: t('countA'), countB: t('countB'),
    faceA: document.querySelectorAll('#handA [data-card]').length,
    faceB: document.querySelectorAll('#handB [data-card]').length,
    backA: document.querySelectorAll('#handA [class*="back"]').length,
    backB: document.querySelectorAll('#handB [class*="back"]').length,
    lastLog: [...document.querySelectorAll('#log div')].slice(-4).map((e) => e.textContent),
    fatal: (($('fatal')?.textContent ?? '').trim()).slice(0, 160),
    trace: ((await import('/web/app.js')).__onlineTrace?.() ?? []).slice(-24),
  };
})()`;

const hist = {};
let done = false;
let idleRun = 0;
for (let i = 0; i < 500; i++) {
  const [r1, r2] = await Promise.all([p1.eval(DRIVE), p2.eval(DRIVE)]);
  hist[r1] = (hist[r1] ?? 0) + 1; hist[r2] = (hist[r2] ?? 0) + 1;
  if (r1 === 'gameover' || r2 === 'gameover') { done = true; break; }
  idleRun = (r1 === 'idle' && r2 === 'idle') ? idleRun + 1 : 0;
  if (idleRun >= 40) {
    log('!! 两边都卡住了，导出现场：');
    log('page1 =', await p1.eval(DUMP));
    log('page2 =', await p2.eval(DUMP));
    break;
  }
  await sleep(80);
}
log('  drive 统计:', JSON.stringify(hist));
check(done, '联机打到终局（出现「再来一局」）');
const shot2 = await p1.shot('02-p1-over'); const shot3 = await p2.shot('03-p2-over');

// 终局双方都该看到对方手牌（over 之后允许揭开）
const overInfo = await p1.eval(`(() => { const o = document.getElementById('ovcard'); return { title: o.querySelector('h2')?.textContent ?? '', handA: o.querySelectorAll('.reveal-col')[0]?.querySelectorAll('.card').length ?? 0, handB: o.querySelectorAll('.reveal-col')[1]?.querySelectorAll('.card').length ?? 0 }; })()`);
log('  终局面板:', JSON.stringify(overInfo));
check(overInfo.title.length > 0, '终局面板显示了结果');

// ---------- 5) 再来一局 ----------
await p1.eval(`document.querySelector('[data-act="online-rematch"]').click()`);
await sleep(500);
await p1.eval(`document.querySelector('[data-act="online-rematch"]')?.click()`);
let rematchOk = false;
for (let i = 0; i < 60; i++) {
  await sleep(300);
  const st = await p2.eval(`(() => { const ov = document.getElementById('overlay'); return (ov && !ov.classList.contains('hidden')) ? 'over' : 'playing'; })()`);
  if (st === 'playing') { rematchOk = true; break; }
}
check(rematchOk, '再来一局：两边同时重开');

check(p1.errors.length === 0, 'page1 控制台无报错' + (p1.errors.length ? ': ' + p1.errors.slice(0, 3).join(' || ') : ''));
check(p2.errors.length === 0, 'page2 控制台无报错' + (p2.errors.length ? ': ' + p2.errors.slice(0, 3).join(' || ') : ''));

log('');
log('截图:', shot1, shot2, shot3);
log(fails.length ? ('结果: ' + fails.length + ' 项失败') : '结果: 全部通过');
edge.kill();
process.exit(fails.length ? 1 : 0);