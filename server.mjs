import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHub } from './src/room.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.md': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};
// 本地：node server.mjs [端口]     云端：平台会注入 PORT（Railway / Render / Fly 都是）
const port = Number(process.env.PORT ?? process.argv[2] ?? 8787);

// 跨域：前端（Cloudflare Pages / 本地文件）和后端不在同一个域名时，必须放行来源。
//   RT_ALLOW_ORIGIN="*"                             → 允许任何来源（默认，网页游戏够用）
//   RT_ALLOW_ORIGIN="https://xx.pages.dev,http://localhost:8787" → 只允许列出的来源
const ALLOW_ORIGIN = String(process.env.RT_ALLOW_ORIGIN ?? '*').trim() || '*';
function corsHeaders(req) {
  let allow = ALLOW_ORIGIN;
  if (ALLOW_ORIGIN !== '*') {
    const list = ALLOW_ORIGIN.split(',').map((x) => x.trim()).filter(Boolean);
    const origin = String(req?.headers?.origin ?? '');
    allow = list.includes(origin) ? origin : (list[0] ?? '*');
  }
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

const hub = createHub();

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

const readBody = (req) => new Promise((resolve) => {
  let text = '';
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > 64 * 1024) { req.destroy(); return; }
    text += chunk;
  });
  req.on('end', () => {
    try { resolve(text ? JSON.parse(text) : {}); } catch { resolve(null); }
  });
  req.on('error', () => resolve(null));
});

// ---------------- 联机 API ----------------
async function api(req, res, url) {
  for (const [k, v] of Object.entries(corsHeaders(req))) res.setHeader(k, v);
  // 浏览器发 JSON 的 POST 之前会先来一个 OPTIONS 预检，必须回 204 + 上面的放行头
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return undefined; }

  const route = url.pathname;
  const q = url.searchParams;
  const body = req.method === 'POST' ? await readBody(req) : {};
  if (body === null) return json(res, 400, { error: 'bad-json' });

  if (route === '/healthz' || route === '/api/health') {
    return json(res, 200, { ok: true, service: 'royal-thief-room', uptime: Math.round(process.uptime()) });
  }

  if (route === '/api/config' && req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      service: 'royal-thief-room',
      version: 1,
      allowOrigin: ALLOW_ORIGIN,
      uptime: Math.round(process.uptime()),
    });
  }

  if (route === '/api/room/create' && req.method === 'POST') {
    const seat = hub.create();
    return json(res, 200, { code: seat.code, seat: seat.seat, token: seat.token });
  }

  if (route === '/api/room/join' && req.method === 'POST') {
    const out = hub.join(body.code ?? q.get('code'));
    if (out.error === 'room-not-found') return json(res, 404, { error: 'room-not-found' });
    if (out.error === 'room-full') return json(res, 409, { error: 'room-full' });
    return json(res, 200, out);
  }

  // 所有需要身份的接口共用：code + token → {room, seat}
  const auth = () => hub.auth(body.code ?? q.get('code'), body.token ?? q.get('token'));

  if (route === '/api/room/state' && req.method === 'GET') {
    const a = auth();
    if (!a) return json(res, 403, { error: 'bad-token' });
    return json(res, 200, hub.snapshot(a.room, a.seat));
  }

  if (route === '/api/room/act' && req.method === 'POST') {
    const a = auth();
    if (!a) return json(res, 403, { error: 'bad-token' });
    const out = hub.act(a.room, a.seat, body.cmd);
    // 「不该你操作 / 指令过时」是对局流程的正常结果，不是服务器错误。
    // 用 200 + ok:false 回，浏览器控制台就不会刷一片红色 409 让人以为坏了。
    if (out.error) return json(res, 200, out);
    hub.publish(a.room);
    return json(res, 200, out);
  }

  if (route === '/api/room/rematch' && req.method === 'POST') {
    const a = auth();
    if (!a) return json(res, 403, { error: 'bad-token' });
    const out = hub.rematch(a.room);
    hub.publish(a.room);
    return json(res, 200, out);
  }

  // 服务器 → 浏览器：SSE 长连接，状态一变就推一份「自己那份」快照
  if (route === '/api/room/sse' && req.method === 'GET') {
    const a = auth();
    if (!a) return json(res, 403, { error: 'bad-token' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': 王权窃贼 联机通道已连接\n\n');
    const send = (snap) => {
      if (res.writableEnded) return;
      res.write('data: ' + JSON.stringify(snap) + '\n\n');
    };
    send(hub.snapshot(a.room, a.seat));
    const off = hub.on(a.room.code, a.seat, send);
    const beat = setInterval(() => { if (!res.writableEnded) res.write(': hb\n\n'); }, 15000);
    const bye = () => { clearInterval(beat); off(); };
    req.on('close', bye);
    res.on('close', bye);
    return undefined;
  }

  return json(res, 404, { error: 'unknown-api' });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // /healthz 也走 api()（云平台的健康检查打的是这个短地址）；
  // OPTIONS 预检统一在 api() 里回 204 + CORS 头
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz' || req.method === 'OPTIONS') {
    try {
      return await api(req, res, url);
    } catch (err) {
      return json(res, 500, { error: 'server-error', message: String(err?.message ?? err) });
    }
  }

  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/web/index.html';
  const target = path.resolve(root, '.' + rel);
  if (target !== root && !target.startsWith(root + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('403 Forbidden');
    return;
  }
  try {
    const data = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
  }
}).listen(port, () => {
  console.log(`王权窃贼 联机后端已启动，端口 ${port}（放行来源 RT_ALLOW_ORIGIN=${ALLOW_ORIGIN}）`);
  console.log(`  健康检查 http://localhost:${port}/healthz`);
  console.log(`  本地牌桌 http://localhost:${port}/web/index.html`);
  const lan = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  if (lan.length) console.log(`  同一局域网的朋友可访问：http://${lan[0]}:${port}/web/index.html （在主界面点「创建房间」拿邀请码）`);
  console.log('  部署到云平台后：前端（Cloudflare Pages 等）把「联机服务器」填成本服务的公网域名即可，前后端不需要同域。');
});