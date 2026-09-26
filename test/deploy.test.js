import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 这组测试锁死「前后端分开部署」的关键契约：
//   前端在 Cloudflare Pages、后端在 Railway / Render / Fly 时，浏览器是跨域请求，
//   后端必须带 CORS 放行头、必须支持 OPTIONS 预检、必须有健康检查接口。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(extraEnv = {}) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const port = 18000 + Math.floor(Math.random() * 20000);
    const env = { ...process.env, ...extraEnv };
    delete env.PORT; // 免得外部环境变量把 --port 覆盖掉
    const proc = spawn(process.execPath, ['server.mjs', String(port)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    proc.stdout.on('data', (d) => { log += d; });
    proc.stderr.on('data', (d) => { log += d; });
    for (let t = 0; t < 60; t++) {
      await sleep(100);
      try {
        const r = await fetch(`http://127.0.0.1:${port}/healthz`);
        if (r.ok) return { port, proc, base: `http://127.0.0.1:${port}`, log: () => log };
      } catch { /* 还没起来 */ }
      if (proc.exitCode !== null) break;
    }
    try { proc.kill(); } catch { /* 忽略 */ }
  }
  throw new Error('联机后端启动失败');
}

const stop = (s) => { try { s.proc.kill(); } catch { /* 忽略 */ } };

test('部署：后端有健康检查与自检接口（云平台的 healthcheck 靠它）', async () => {
  const s = await boot();
  try {
    const h = await fetch(s.base + '/healthz');
    assert.equal(h.status, 200);
    const hj = await h.json();
    assert.equal(hj.ok, true);
    assert.equal(hj.service, 'royal-thief-room');

    const c = await fetch(s.base + '/api/config');
    assert.equal(c.status, 200);
    const cj = await c.json();
    assert.equal(cj.ok, true);
    assert.equal(cj.allowOrigin, '*');
  } finally { stop(s); }
});

test('部署：跨域请求必须带 CORS 头、OPTIONS 预检必须放行', async () => {
  const s = await boot();
  try {
    const origin = 'https://royal-thief.pages.dev';
    const pre = await fetch(s.base + '/api/room/create', {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(pre.status, 204, '预检要回 204，浏览器才会真正发 POST');
    assert.equal(pre.headers.get('access-control-allow-origin'), '*');
    assert.match(pre.headers.get('access-control-allow-methods') ?? '', /POST/);
    assert.match(pre.headers.get('access-control-allow-headers') ?? '', /content-type/i);

    const post = await fetch(s.base + '/api/room/create', { method: 'POST', headers: { Origin: origin } });
    assert.equal(post.status, 200);
    assert.equal(post.headers.get('access-control-allow-origin'), '*', '真正的请求也要放行，否则前端读不到响应');
  } finally { stop(s); }
});

test('部署：可以用 RT_ALLOW_ORIGIN 只放行自己的站点', async () => {
  const s = await boot({ RT_ALLOW_ORIGIN: 'https://royal-thief.pages.dev' });
  try {
    const ok = await fetch(s.base + '/api/config', { headers: { Origin: 'https://royal-thief.pages.dev' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://royal-thief.pages.dev');

    // 陌生来源拿不到自己的 origin，浏览器就会拦掉（服务端仍然活着）
    const evil = await fetch(s.base + '/api/config', { headers: { Origin: 'https://evil.example' } });
    assert.notEqual(evil.headers.get('access-control-allow-origin'), 'https://evil.example');
  } finally { stop(s); }
});

test('部署：静态前端（另一个域）能跨域建房、拿邀请码、第二个人加入', async () => {
  const s = await boot();
  try {
    const origin = 'https://royal-thief.pages.dev';
    const mk = await fetch(s.base + '/api/room/create', { method: 'POST', headers: { Origin: origin } });
    const room = await mk.json();
    assert.match(room.code, /^[A-Z0-9]{4}$/, '房主应拿到 4 位邀请码');
    assert.equal(room.seat, 'A');

    const jn = await fetch(s.base + '/api/room/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ code: room.code }),
    });
    const joined = await jn.json();
    assert.equal(joined.seat, 'B', '输入邀请码的人应坐 B');

    const snap = await fetch(`${s.base}/api/room/state?code=${room.code}&token=${room.token}`, { headers: { Origin: origin } });
    assert.equal(snap.status, 200);
    const st = await snap.json();
    assert.ok(st.state, '应能拿到脱敏牌局快照');
    assert.equal(st.state.pending?.kind, 'function-phase', '双方到齐后开局停在能力牌阶段');

    const bad = await fetch(`${s.base}/api/room/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ code: 'ZZZZ' }),
    });
    assert.equal(bad.status, 404, '不存在的邀请码要回 404');
  } finally { stop(s); }
});

test('部署：前端后端地址解析（?server= > 本机保存 > 内置默认；ws/wss 自动转 http/https）', async () => {
  const { DEFAULT_SERVER, normalizeServer, serverOrigin, apiUrl, saveServerOrigin } = await import('../web/server-url.js');
  globalThis.location = { search: '', protocol: 'https:', origin: 'https://royal-thief.pages.dev', pathname: '/' };
  globalThis.localStorage = {
    _v: {},
    getItem(k) { return this._v[k] ?? null; },
    setItem(k, v) { this._v[k] = String(v); },
  };
  try {
    assert.equal(DEFAULT_SERVER, '', '内置默认留空 = 同源，本地开发零配置');
    assert.equal(serverOrigin(), '');
    assert.equal(apiUrl('/api/room/create'), '/api/room/create', '同源时保持相对路径');

    saveServerOrigin('wss://abc.up.railway.app/');
    assert.equal(serverOrigin(), 'https://abc.up.railway.app', 'wss 要转成 https（本项目的联机走 http + SSE）');
    assert.equal(apiUrl('/healthz'), 'https://abc.up.railway.app/healthz');

    globalThis.location.search = '?room=ABCD&server=ws://localhost:2567';
    assert.equal(serverOrigin(), 'http://localhost:2567', '地址栏参数优先级最高（邀请链接自带后端地址）');

    assert.equal(normalizeServer('abc.example.com'), 'https://abc.example.com');
    assert.equal(normalizeServer(''), '');
  } finally {
    delete globalThis.location;
    delete globalThis.localStorage;
  }
});
