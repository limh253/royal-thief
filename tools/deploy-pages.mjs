// 一键发布到 GitHub Pages（长期免费、永久在线、不需要自己开服务器）。
//   node tools/build-site.mjs && node tools/deploy-pages.mjs [仓库名]
//
// 凭据来源（按顺序找）：
//   1) 环境变量 GITHUB_TOKEN / GH_TOKEN
//   2) 本机 git 保存的 GitHub 凭据（git credential fill）
// 发布的仓库是「公开的」，因为免费账号的 Pages 只对公开仓库开放。
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, cpSync, readdirSync } from 'node:fs';
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
    const out = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
    });
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

const api = async (method, url, body) => {
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
  return { status: res.status, ok: res.ok, json, text };
};

const me = await api('GET', '/user');
if (!me.ok) { console.error('GitHub 凭据无效：' + me.status + ' ' + me.text.slice(0, 200)); process.exit(1); }
const owner = me.json.login;
console.log('发布账号：' + owner + '　仓库：' + REPO);

// 1) 建仓库（已存在就复用）
const created = await api('POST', '/user/repos', {
  name: REPO,
  description: '王权窃贼 Royal Thief · 双人回合制卡牌博弈（在线可玩）',
  homepage: `https://${owner}.github.io/${REPO}/`,
  private: false,
  has_issues: true,
  has_wiki: false,
  auto_init: false,
});
if (created.ok) console.log('已创建仓库');
else if (created.status === 422) console.log('仓库已存在，直接更新');
else { console.error('建仓库失败：' + created.status + ' ' + created.text.slice(0, 300)); process.exit(1); }

// 2) 组装一份要发布的目录：站点文件放根目录 + 项目源码一起带上（这样仓库本身也有用）
const stage = path.join(root, 'dist', '.pages-stage');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const name of ['index.html', 'mobile.html', '_headers']) cpSync(path.join(siteDir, name), path.join(stage, name));
cpSync(path.join(siteDir, 'vendor'), path.join(stage, 'vendor'), { recursive: true });
writeFileSync(path.join(stage, '.nojekyll'), '', 'utf8');
writeFileSync(path.join(stage, 'robots.txt'), 'User-agent: *\nAllow: /\n', 'utf8');
writeFileSync(path.join(stage, 'README.md'), `# 王权窃贼 Royal Thief

双人回合制卡牌博弈。**在线直接玩：https://${owner}.github.io/${REPO}/**

- 单机：打开链接就是人机对战 / 自动观战，不连任何后端
- 双人：主界面 → 联机对战 → 创建房间，把邀请码或链接发给朋友（免服务器，走公共中继）
- 手游版：同域名下的 \`mobile.html\`

本仓库根目录是构建产物（由 \`node tools/build-site.mjs\` 生成）；源码在 \`src/\` \`web/\` \`tools/\`。
`, 'utf8');

const SKIP = new Set(['node_modules', '.git', 'dist', '.pages-stage']);
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (SKIP.has(entry.name)) continue;
  cpSync(path.join(root, entry.name), path.join(stage, entry.name), { recursive: true });
}
writeFileSync(path.join(stage, '.gitignore'), 'node_modules/\ndist/\n', 'utf8');

// 3) 推上去（用 http.extraheader 传令牌，不把令牌写进 .git/config）
const git = (args, opts = {}) => execFileSync('git', args, { cwd: stage, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts });
const auth = 'AUTHORIZATION: basic ' + Buffer.from('x-access-token:' + token, 'utf8').toString('base64');
const gitAuth = (args) => git(['-c', 'http.extraheader=' + auth, ...args]);
const url = `https://github.com/${owner}/${REPO}.git`;

git(['init', '-b', 'main']);
git(['config', 'user.name', owner]);
git(['config', 'user.email', `${owner}@users.noreply.github.com`]);
git(['add', '-A']);
git(['commit', '-m', '发布：王权窃贼在线版 ' + new Date().toISOString().slice(0, 19).replace('T', ' ')]);
gitAuth(['push', '--force', url, 'main:main']);
console.log('已推送（含站点文件与源码）');

// 4) 打开 Pages
const pages = await api('POST', `/repos/${owner}/${REPO}/pages`, { source: { branch: 'main', path: '/' } });
if (pages.ok || pages.status === 409) {
  console.log('GitHub Pages 已开启');
  if (pages.status === 409) await api('POST', `/repos/${owner}/${REPO}/pages/builds`);
} else {
  console.log('开启 Pages 返回 ' + pages.status + '：' + pages.text.slice(0, 200));
}

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
    const r = await fetch(SITE, { cache: 'no-store' });
    const t = await r.text();
    if (r.ok && t.includes('data-single-file')) { live = true; break; }
  } catch { /* 还在构建 */ }
  await new Promise((r) => setTimeout(r, 5000));
}
console.log(live ? ' 已上线' : ' 还没好（去仓库的 Actions / Pages 页面看进度，通常再等一分钟）');
console.log('');
console.log('以后再更新：改完代码跑 node tools/build-site.mjs && node tools/deploy-pages.mjs，链接不变');
