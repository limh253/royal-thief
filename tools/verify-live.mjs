// 线上验收：直接打开公网链接，验证「单机可玩 + 邀请码联机可用」。
//   node tools/verify-live.mjs https://xxxx.csb.app/ [截图目录]
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = process.argv[2] ?? 'https://yypk85.csb.app/';
const SHOTS = process.argv[3] ?? path.join(os.tmpdir(), 'rt_live_shots');
const PORT = 9470 + Math.floor(Math.random() * 30);
const EDGE = process.env.RT_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(SHOTS, { recursive: true });

spawn(EDGE, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', '--hide-scrollbars',
  '--window-size=1560,1000', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(os.tmpdir(), 'rt_live_' + Date.now())}`, 'about:blank'],
  { stdio: 'ignore', windowsHide: true });

let ver = null;
for (let i = 0; i < 100; i++) { try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { /* 等启动 */ } await sleep(300); }
if (!ver) throw new Error('devtools 未就绪');

function conn(url) {
  const ws = new WebSocket(url);
  let seq = 0; const pend = new Map(); const handlers = new Map();
  const ready = new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
    const h = handlers.get(m.method); if (h) h(m.params);
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq; pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, 40000);
  });
  return { ready, send, on: (m, fn) => handlers.set(m, fn) };
}

async function newPage(w = 1560, h = 1000) {
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const c = conn(t.webSocketDebuggerUrl);
  await c.ready;
  const errs = [];
  c.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') errs.push((p.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ')); });
  c.on('Log.entryAdded', (p) => { if (p.entry?.level === 'error') errs.push(p.entry.text); });
  c.on('Runtime.exceptionThrown', (p) => errs.push(p.exceptionDetails?.exception?.description ?? 'exception'));
  await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Log.enable');
  c.on('Emulation.setDeviceMetricsOverride', () => {});
  await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  const ev = async (expr) => {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page error: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result.value;
  };
  const goto = async (url) => {
    await c.send('Page.navigate', { url });
    for (let i = 0; i < 200; i++) { await sleep(250); try { if (await ev('Boolean(globalThis.__RT_BOOTED__)')) return; } catch { /* 还在加载 */ } }
    throw new Error('页面没启动: ' + url);
  };
  const shot = async (name) => {
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(SHOTS, name + '.png');
    fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
    console.log('  截图 ' + p);
  };
  return { c, ev, goto, errs, shot };
}

const fails = [];
const ok = (cond, label, extra = '') => { console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  [' + extra + ']' : '')); if (!cond) fails.push(label); };

// 免账号沙箱第一次被访问时要冷启动，这会儿会先回 400 或一张加载页；
// 等到真的拿到我们的网页（含 __RT_BOOTED__ 的那份）再开始验收。
async function warmUp(url, label) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      const t = await r.text();
      if (r.ok && t.includes('data-single-file')) { if (i) console.log('  预热完成（等了 ' + i * 3 + 's）'); return true; }
    } catch { /* 还没起来 */ }
    await sleep(3000);
  }
  console.log('  ' + label + ' 预热超时，仍然继续验收');
  return false;
}

console.log('线上地址：' + BASE);
await warmUp(BASE, '站点');
const p1 = await newPage();
const p2 = await newPage();

// ---------- 1) 单机：人机对战能开局能出牌 ----------
await p1.goto(BASE);
ok(await p1.ev(`Boolean(globalThis.__RT_BOOTED__)`), '页面加载成功（脚本跑起来了）');
ok(await p1.ev(`document.querySelectorAll('.mbtn').length >= 3`), '主界面出现三种对局方式');
await p1.shot('01-主界面');
await p1.ev(`document.querySelector('[data-act="menu-start"]').click()`);
await sleep(1500);
ok(await p1.ev(`Boolean(document.getElementById('handA')?.children.length)`), '人机对战牌桌出现手牌');
const drive = async (page, handSel) => page.ev(`(() => {
  const ov = document.getElementById('overlay');
  if (ov && !ov.classList.contains('hidden')) return 'overlay';
  const btn = (sel) => document.querySelector(sel);
  const hand = (sel) => document.querySelector('${handSel} ' + sel);
  if (hand('[data-play]')) { hand('[data-play]').click(); return 'play'; }
  const ps = btn('[data-act="pass"]'); if (ps) { ps.click(); return 'pass'; }
  const person = hand('[data-person]');
  if (person) { person.click(); const f = btn('[data-act="fight"]'); if (f && !f.disabled) { f.click(); return 'fight'; } return 'selected'; }
  const pd = btn('[data-act="pass-declare"]'); if (pd) { pd.click(); return 'pass-declare'; }
  return 'idle';
})()`);
const acts = new Set();
for (let i = 0; i < 60 && acts.size < 3; i++) { acts.add(await drive(p1, '#handA')); await sleep(400); }
ok(acts.has('play') || acts.has('pass') || acts.has('fight'), '单机能正常出牌推回合', [...acts].join(','));
await p1.shot('02-人机对战');

// ---------- 2) 联机：一条链接，两台设备 ----------
await p1.goto(BASE);
await p1.ev(`localStorage.removeItem('rt-server'); sessionStorage.clear(); localStorage.removeItem('rt-rooms')`);
await p1.goto(BASE);
await p1.ev(`document.querySelector('[data-act="online-create"]').click()`);
let code = '';
for (let i = 0; i < 160; i++) { await sleep(250); code = await p1.ev(`(document.getElementById('seed')?.textContent ?? '').trim()`); if (/^[A-Z0-9]{4}$/.test(code)) break; }
ok(/^[A-Z0-9]{4}$/.test(code), '线上免服务器建房成功，拿到邀请码', code);
// 中继客户端是「点联机时才按需加载」的，等它出现（正常 1 秒内）
let mqttOk = false;
for (let i = 0; i < 40; i++) { mqttOk = await p1.ev('Boolean(globalThis.mqtt && globalThis.mqtt.connect)'); if (mqttOk) break; await sleep(500); }
ok(mqttOk, '中继客户端从站点本地加载成功');
await p1.shot('03-房主等待');

const link = BASE + '?room=' + code + '&relay=1';
console.log('  邀请链接：' + link);
await p2.goto(link);
let seatB = '';
for (let i = 0; i < 160; i++) { await sleep(250); seatB = await p2.ev(`document.getElementById('nameB')?.textContent ?? ''`); if (String(seatB).includes('你')) break; }
ok(String(seatB).includes('你'), '朋友点链接进来坐玩家 B', String(seatB));
ok((await p1.ev(`document.querySelectorAll('#handA [data-card]').length`)) >= 4, '房主看得到自己的手牌');
ok((await p2.ev(`document.querySelectorAll('#handB [data-card]').length`)) >= 4, '客机看得到自己的手牌');
ok(!(await p2.ev(`/data-card=/.test(document.getElementById('handA').innerHTML)`)), '客机看不到房主的手牌');
const acts2 = new Set();
for (let i = 0; i < 90 && acts2.size < 3; i++) { acts2.add(await drive(p1, '#handA')); acts2.add(await drive(p2, '#handB')); await sleep(300); }
ok(acts2.has('play') || acts2.has('pass') || acts2.has('fight'), '双方都能出牌，牌局推进', [...acts2].join(','));
await p1.shot('04-联机对战-房主');
await p2.shot('05-联机对战-客机');
ok(p1.errs.length === 0, '房主页面控制台无报错', p1.errs.slice(0, 2).join(' | '));
ok(p2.errs.length === 0, '客机页面控制台无报错', p2.errs.slice(0, 2).join(' | '));

// ---------- 3) 手机版 ----------
const p3 = await newPage(430, 900);
await p3.goto(new URL('mobile.html', BASE).href);
ok(await p3.ev(`Boolean(globalThis.__RT_BOOTED__)`), '手机版页面加载成功');
await p3.shot('06-手机版主界面');
await p3.ev(`document.querySelector('[data-act="menu-start"]').click()`);
await sleep(1600);
ok(await p3.ev(`Boolean(document.getElementById('handA')?.children.length)`), '手机版能开局');
await p3.shot('07-手机版对局');

console.log(fails.length ? '\n结果：' + fails.length + ' 项失败' : '\n结果：全部通过');
process.exit(fails.length ? 1 : 0);
