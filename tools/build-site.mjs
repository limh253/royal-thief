import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 把游戏打包成一个「可以直接丢到静态托管」的文件夹：dist/site/
//   dist/site/index.html   端游版（单文件，零外部依赖）
//   dist/site/mobile.html  手游版
//   dist/site/_headers     Cloudflare Pages / Netlify 用的缓存头
// 直接把 dist/site 整个拖到 Cloudflare Pages（或任何静态托管）就是一个公网可玩的游戏。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'dist', 'site');

execFileSync(process.execPath, [path.join(root, 'tools/build-single.mjs')], { cwd: root, stdio: 'inherit' });

const desk = readFileSync(path.join(root, 'dist', '王权窃贼.html'), 'utf8');
const mob = readFileSync(path.join(root, 'dist', '王权窃贼-手游.html'), 'utf8');

rmSync(site, { recursive: true, force: true });
mkdirSync(site, { recursive: true });

// 两个单文件在站点里改名叫 index.html / mobile.html，互相的链接也跟着换
writeFileSync(path.join(site, 'index.html'),
  desk.split('"./王权窃贼-手游.html"').join('"./mobile.html"'), 'utf8');
writeFileSync(path.join(site, 'mobile.html'),
  mob.split('"./王权窃贼.html"').join('"./index.html"'), 'utf8');

// 免后端联机用的中继客户端：单独放一个文件，只有点联机时才加载（单机不碰它）
mkdirSync(path.join(site, 'vendor'), { recursive: true });
writeFileSync(path.join(site, 'vendor', 'mqtt.min.js'),
  readFileSync(path.join(root, 'web', 'vendor', 'mqtt.min.js'), 'utf8'), 'utf8');

// 静态托管的缓存策略：HTML 每次校验，避免玩家拿到旧版本
writeFileSync(path.join(site, '_headers'),
  '/*\n  Cache-Control: public, max-age=0, must-revalidate\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer-when-downgrade\n', 'utf8');

console.log('已生成静态站点: dist/site/（index.html + mobile.html）→ 整个文件夹丢到 Cloudflare Pages 即可');
console.log('  单机：打开链接就能玩，不连任何后端；联机：主界面 → 创建房间 / 输入邀请码');
console.log('  联机两条通路：留空服务器地址 = 免服务器公共中继；填后端地址 = 自建 server.mjs');
