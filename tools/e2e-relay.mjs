// 免后端联机端到端：两个真实浏览器页面 + 公共 MQTT 中继，跑通「建房 → 用链接进房 → 各出一手」。
//   1) 先起静态站：node tools/serve-site.mjs
//   2) node tools/e2e-relay.mjs
// 需要联网（中继是公共 broker）。没有网络时它会明确报「中继连不上」，不会假装通过。
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const SITE = process.argv[2] ?? 'http://localhost:8788/index.html';
const PORT = 9440 + Math.floor(Math.random() * 40);
const EDGE = process.env.RT_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

spawn(EDGE, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', '--hide-scrollbars',
  '--window-size=1440,900', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(os.tmpdir(), 'rt_relay_e2e_' + Date.now())}`, 'about:blank'],
  { stdio: 'ignore', windowsHide: true });

let ver = null;
for (let i = 0; i < 80; i++) { try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { /* 等启动 */ } await sleep(250); }
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
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, 30000);
  });
  return { ready, send, on: (m, fn) => handlers.set(m, fn) };
}

async function newPage() {
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const c = conn(t.webSocketDebuggerUrl);
  await c.ready;
  const errs = [];
  c.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') errs.push((p.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ')); });
  c.on('Log.entryAdded', (p) => { if (p.entry?.level === 'error') errs.push(p.entry.text); });
  c.on('Runtime.exceptionThrown', (p) => errs.push(p.exceptionDetails?.exception?.description ?? 'exception'));
  await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Log.enable');
  const ev = async (expr) => {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page error: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result.value;
  };
  const goto = async (url) => {
    await c.send('Page.navigate', { url });
    for (let i = 0; i < 120; i++) { await sleep(250); try { if (await ev('Boolean(globalThis.__RT_BOOTED__)')) return; } catch { /* 还在加载 */ } }
    throw new Error('页面没启动: ' + url);
  };
  return { c, ev, goto, errs };
}

const fails = [];
const ok = (cond, label, extra = '') => { console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  [' + extra + ']' : '')); if (!cond) fails.push(label); };

const p1 = await newPage();
const p2 = await newPage();

await p1.goto(SITE);
await p1.ev(`localStorage.removeItem('rt-server'); sessionStorage.clear(); localStorage.removeItem('rt-rooms')`);
await p1.goto(SITE);
ok(await p1.ev(`Boolean(document.querySelector('[data-act="online-create"]'))`), '静态页面上有「创建房间」');

// 1) 房主建房（不填服务器地址 → 自动走公共中继）
await p1.ev(`document.querySelector('[data-act="online-create"]').click()`);
let code = '';
for (let i = 0; i < 120; i++) { await sleep(250); code = await p1.ev(`(document.getElementById('seed')?.textContent ?? '').trim()`); if (/^[A-Z0-9]{4}$/.test(code)) break; }
ok(/^[A-Z0-9]{4}$/.test(code), '免服务器建房成功，拿到邀请码', code);
ok(await p1.ev(`(document.getElementById('seedLabel')?.textContent ?? '') === '房间'`), '顶栏显示「房间」而不是「种子」');
ok(await p1.ev(`Boolean(globalThis.mqtt && globalThis.mqtt.connect)`), '中继客户端从站点本地 vendor/ 加载成功');

// 2) 第二个人点邀请链接进来
const link = SITE + '?room=' + code + '&relay=1';
await p2.goto(link);
let seatB = '';
for (let i = 0; i < 140; i++) { await sleep(250); seatB = await p2.ev(`document.getElementById('nameB')?.textContent ?? ''`); if (String(seatB).includes('你')) break; }
ok(String(seatB).includes('你'), '点链接进来坐的是玩家 B（你）', String(seatB));
ok(String(await p1.ev(`document.getElementById('nameA').textContent`)).includes('你'), '房主仍是玩家 A');

const h1 = await p1.ev(`document.querySelectorAll('#handA [data-card]').length`);
const h2 = await p2.ev(`document.querySelectorAll('#handB [data-card]').length`);
ok(h1 >= 4 && h2 >= 4, '双方各自看得到自己的手牌', h1 + '/' + h2);
ok(!(await p2.ev(`/data-card=/.test(document.getElementById('handA').innerHTML)`)), '客机看不到房主手牌（只有背面）');

// 3) 两边各出一手，牌局要往前走
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
const seen = new Set();
for (let i = 0; i < 120 && seen.size < 3; i++) {
  seen.add(await drive(p1, '#handA'));
  seen.add(await drive(p2, '#handB'));
  await sleep(250);
}
ok(seen.has('pass') || seen.has('fight') || seen.has('play'), '两边都能通过中继提交指令', [...seen].join(','));
const round1 = await p1.ev(`document.getElementById('turnbar').textContent`);
ok(/回合/.test(round1), '牌桌在推进', round1);
ok(p1.errs.length === 0, '房主页面控制台无报错', p1.errs.slice(0, 2).join(' | '));
ok(p2.errs.length === 0, '客机页面控制台无报错', p2.errs.slice(0, 2).join(' | '));

console.log(fails.length ? '\n结果：' + fails.length + ' 项失败' : '\n结果：全部通过');
process.exit(fails.length ? 1 : 0);
