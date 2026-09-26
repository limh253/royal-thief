// 一键发布到公网（免账号）：把 dist/site 的静态页面推到 CodeSandbox 的静态托管，
// 拿到 https://<id>.csb.app/ 这样的链接，任何人点开就能玩（单机直接玩，联机输邀请码）。
//
//   node tools/build-site.mjs && node tools/deploy-csb.mjs
//
// 说明：用 CodeSandbox 的 define 接口把「整个站点」当作一个静态项目提交。
// 同样的内容重复提交会拿到同一个链接，不会每次生成一堆孤儿沙箱。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import LZString from 'lz-string';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = path.join(root, 'dist', 'site');
const cacheFile = path.join(root, 'dist', '.csb-url');

if (!existsSync(path.join(siteDir, 'index.html'))) {
  console.error('找不到 dist/site/index.html，先跑：node tools/build-site.mjs');
  process.exit(1);
}

const FILES = ['index.html', 'mobile.html', '_headers', 'vendor/mqtt.min.js'];
const files = {};
for (const name of FILES) {
  const p = path.join(siteDir, name);
  if (!existsSync(p)) continue;
  files[name] = { content: readFileSync(p, 'utf8'), isBinary: false };
}
files['sandbox.config.json'] = { content: JSON.stringify({ template: 'static' }), isBinary: false };

const parameters = LZString.compressToBase64(JSON.stringify({ files }));
console.log('打包完成：' + Object.keys(files).join(' / ') + '，参数长度 ' + parameters.length);

const res = await fetch('https://codesandbox.io/api/v1/sandboxes/define?json=1', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
  body: new URLSearchParams({ parameters }),
});
const text = await res.text();
if (!res.ok) {
  console.error('发布失败 HTTP ' + res.status + '：' + text.slice(0, 300));
  process.exit(1);
}
let id = null;
try { id = JSON.parse(text).sandbox_id; } catch { /* 下面统一报错 */ }
if (!id) {
  console.error('发布失败：' + text.slice(0, 300));
  process.exit(1);
}

const url = `https://${id}.csb.app/`;
writeFileSync(cacheFile, url + '\n', 'utf8');
// 沙箱要冷启动：先替玩家把第一次访问等掉，唤醒后后面谁来都是秒开
process.stdout.write('正在唤醒站点（免账号沙箱第一次访问要冷启动）…');
let warm = false;
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    const t = await r.text();
    if (r.ok && t.includes('data-single-file')) { warm = true; break; }
  } catch { /* 还没起来 */ }
  await new Promise((r) => setTimeout(r, 3000));
}
console.log(warm ? ' 就绪' : ' 仍未就绪（首次访问可能需要等十几秒）');

console.log('');
console.log('发布成功，公网链接（任何人点开就能玩）：');
console.log('  端游版  ' + url);
console.log('  手游版  ' + url + 'mobile.html');
console.log('');
console.log('（同域名下再发一次不会换链接；链接已写入 dist/.csb-url）');
