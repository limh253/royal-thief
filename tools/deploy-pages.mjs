// 一键发布到 GitHub Pages（长期免费、永久在线、不需要自己开服务器）。
//   node tools/build-site.mjs && node tools/deploy-pages.mjs [仓库名]
//
// 走 GitHub 的 Git Data API（纯 HTTPS）而不是 git push：
// 国内网络对 github.com 的 git 协经常被重置，HTTPS REST 稳定得多，而且只发一次请求就把整棵树建好。
//
// 凭据来源（按顺序找）：
//   1) 环境变量 GITHUB_TOKEN / GH_TOKEN
//   2) 本机 git 保存的 GitHub 凭据（git credential fill）
// 发布的仓库是「公开的」，因为免费账号的 Pages 只对公开仓库开放。
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, cpSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = path.join(root, 'dist', 'site');
const REPO = (process.argv[2] ?? 'royal-thief').trim();
const API = 'https://api.github.com';

if (!existsSync(path.join(siteDir, 'index.html'))) {
  console.error('找不到 dist/site/index.html，先跑：node tools/build-site.mjs');
  process.exit(1);
}

function readToken() {
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (env) return env.trim();
  try {
    const out = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
    const line = out.split('\n').find((l) => l.startsWith('password='));
    if (line) return line.slice('password='.length).trim();
  } catch { /* 下面统一报错 */ }
  return '';
}

const token = readToken();
if (!token) {
  console.error('没找到 GitHub 凭据：先设置 GITHUB_TOKEN，或用 git 登录过 GitHub 后重试');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, body, tries = 4) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url.startsWith('http') ? url : API + url, {
        method,
        headers: {
          Authorization: 'token ' + token,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'royal-thief-deploy',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }
      if (res.status >= 500 && i < tries - 1) { last = { status: res.status, text }; await sleep(1500 * (i + 1)); continue; }
      return { status: res.status, ok: res.ok, json, text };
    } catch (err) {
      last = { status: 0, text: String(err?.message ?? err) };
      if (i < tries - 1) { console.log('  网络抖动，重试第 ' + (i + 2) + ' 次…'); await sleep(1500 * (i + 1)); continue; }
      return { status: 0, ok: false, json: null, text: last.text };
    }
  }
  return { status: last?.status ?? 0, ok: false, json: null, text: last?.text ?? '' };
}

const me = await api('GET', '/user');
if (!me.ok) { console.error('GitHub 凭据无效：' + me.status + ' ' + String(me.text).slice(0, 200)); process.exit(1); }
const owner = me.json.login;
console.log('发布账号：' + owner + '　仓库：' + REPO);

// 1) 建仓库（已存在就复用）
const created = await api('POST', '/user/repos', {
  name: REPO,
  description: '王权窃贼 Royal Thief · 双人回合制卡牌博弈（点开即玩）',
  homepage: `https://${owner}.github.io/${REPO}/`,
  private: false,
  has_issues: true,
  has_wiki: false,
  auto_init: false,
});
if (created.ok) console.log('已创建仓库');
else if (created.status === 422) console.log('仓库已存在，直接更新');
else { console.error('建仓库失败：' + created.status + ' ' + String(created.text).slice(0, 300)); process.exit(1); }

// 2) 组装要发布的目录：站点文件放根目录（Pages 直接就能跑）+ 项目源码一起带上（仓库本身也有用）
const stage = path.join(root, 'dist', '.pages-stage');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const name of ['index.html', 'mobile.html', '_headers']) cpSync(path.join(siteDir, name), path.join(stage, name));
cpSync(path.join(siteDir, 'vendor'), path.join(stage, 'vendor'), { recursive: true });
writeFileSync(path.join(stage, '.nojekyll'), '', 'utf8');   // 否则 GitHub 的 Jekyll 会吃掉 _headers 这类文件
writeFileSync(path.join(stage, 'robots.txt'), 'User-agent: *\nAllow: /\n', 'utf8');

const SKIP = new Set(['node_modules', '.git', 'dist', '.pages-stage', '.pages-url']);
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (SKIP.has(entry.name)) continue;
  cpSync(path.join(root, entry.name), path.join(stage, entry.name), { recursive: true });
}
writeFileSync(path.join(stage, '.gitignore'), 'node_modules/\ndist/\n', 'utf8');

// 3) 收集成 Git 树（二进制跳过，本项目全是文本）
const walk = (dir, base = '') => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + entry.name : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) { out.push(...walk(abs, rel)); continue; }
    const buf = readFileSync(abs);
    const binary = buf.includes(0);
    if (binary) continue;
    out.push({ path: rel, mode: '100644', type: 'blob', content: buf.toString('utf8') });
  }
  return out;
};
const tree = walk(stage);
console.log('待发布文件 ' + tree.length + ' 个，共 ' + (tree.reduce((n, f) => n + f.content.length, 0) / 1024).toFixed(0) + ' KB');

const ref = await api('GET', `/repos/${owner}/${REPO}/git/ref/heads/main`);
const parent = ref.ok ? ref.json.object.sha : null;

const newTree = await api('POST', `/repos/${owner}/${REPO}/git/trees`, { tree });
if (!newTree.ok) { console.error('建树失败：' + newTree.status + ' ' + String(newTree.text).slice(0, 300)); process.exit(1); }

const commit = await api('POST', `/repos/${owner}/${REPO}/git/commits`, {
  message: '发布：王权窃贼在线版 ' + new Date().toISOString().slice(0, 19).replace('T', ' '),
  tree: newTree.json.sha,
  ...(parent ? { parents: [parent] } : {}),
});
if (!commit.ok) { console.error('建提交失败：' + commit.status + ' ' + String(commit.text).slice(0, 300)); process.exit(1); }

const put = parent
  ? await api('PATCH', `/repos/${owner}/${REPO}/git/refs/heads/main`, { sha: commit.json.sha, force: true })
  : await api('POST', `/repos/${owner}/${REPO}/git/refs`, { ref: 'refs/heads/main', sha: commit.json.sha });
if (!put.ok) { console.error('更新分支失败：' + put.status + ' ' + String(put.text).slice(0, 300)); process.exit(1); }
console.log('已推送（站点文件 + 项目源码）');

// 4) 打开 Pages
const pages = await api('POST', `/repos/${owner}/${REPO}/pages`, { source: { branch: 'main', path: '/' } });
if (pages.ok) console.log('GitHub Pages 已开启');
else if (pages.status === 409) { console.log('GitHub Pages 已在运行，触发一次重建'); await api('POST', `/repos/${owner}/${REPO}/pages/builds`); }
else console.log('开启 Pages 返回 ' + pages.status + '：' + String(pages.text).slice(0, 200));

const SITE = `https://${owner}.github.io/${REPO}/`;
console.log('');
console.log('公网链接（任何人点开就能玩）：');
console.log('  端游版  ' + SITE);
console.log('  手游版  ' + SITE + 'mobile.html');
writeFileSync(path.join(root, 'dist', '.pages-url'), SITE + '\n', 'utf8');

// 5) 等它真的能打开（第一次构建要 1~2 分钟）
process.stdout.write('等 GitHub Pages 构建并唤醒…');
let live = false;
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(SITE + '?v=' + Date.now(), { cache: 'no-store' });
    const t = await r.text();
    if (r.ok && t.includes('data-single-file')) { live = true; break; }
  } catch { /* 还在构建 */ }
  await sleep(5000);
}
console.log(live ? ' 已上线' : ' 还没好（去仓库的 Actions / Pages 看进度，通常再等一分钟）');
console.log('');
console.log('以后再更新：改完代码跑 node tools/build-site.mjs && node tools/deploy-pages.mjs，链接不变');
