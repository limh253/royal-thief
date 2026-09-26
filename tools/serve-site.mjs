// 本地模拟「静态前端托管」（Cloudflare Pages / Nginx / GitHub Pages 都等价）。
//   node tools/serve-site.mjs [端口] [目录]
// 默认端口 8788，目录 dist/site（由 node tools/build-site.mjs 生成）。
// 用途：验证「前端在 A 域名、后端在 B 域名」的跨域联机链路。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] ?? process.env.PORT ?? 8788);
const dir = path.resolve(root, process.argv[3] ?? 'dist/site');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.join(dir, rel);
  if (!file.startsWith(dir)) { res.writeHead(403).end('forbidden'); return; }
  try {
    const buf = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
  }
}).listen(port, () => {
  console.log(`静态站点（模拟 Cloudflare Pages）: http://localhost:${port}/  目录: ${dir}`);
});