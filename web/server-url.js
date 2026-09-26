// 联机后端地址解析：让「静态前端」和「联机后端」可以分开部署。
//
// 部署方式（静态前端 Cloudflare Pages + 独立后端 Railway / Render / Fly）：
//   把下面 DEFAULT_SERVER 改成你的后端地址，然后重新打包（node tools/build-site.mjs）。
//   留空 = 同源：用 `node server.mjs` 本地起、或前后端一起部署在同一台机器时用这个。
//
// 也可以不改代码，直接在界面上填：
//   优先级 = 地址栏 ?server= > 玩家在本机存过的地址 > DEFAULT_SERVER > 同源

export const DEFAULT_SERVER = '';

// 允许玩家直接粘 `wss://xxx.up.railway.app` 这种写法，统一成 http(s)
export function normalizeServer(v) {
  let s = String(v ?? '').trim();
  if (!s) return '';
  s = s.replace(/\/+$/, '');
  if (/^wss:\/\//i.test(s)) s = 'https://' + s.slice(6);
  else if (/^ws:\/\//i.test(s)) s = 'http://' + s.slice(5);
  else if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  return s;
}

function fromQuery() {
  try {
    if (typeof location === 'undefined' || !location.search) return '';
    const raw = new URLSearchParams(location.search).get('server');
    return raw ? normalizeServer(raw) : '';
  } catch { return ''; }
}

function fromStorage() {
  try { return normalizeServer(globalThis.localStorage?.getItem('rt-server')); } catch { return ''; }
}

function fromConfig() {
  try { return normalizeServer(globalThis.RT_SERVER || DEFAULT_SERVER); } catch { return ''; }
}

// 联机后端根地址；'' 表示「跟当前网页同一个域名」
export function serverOrigin() {
  return fromQuery() || fromStorage() || fromConfig();
}

// 把 /api/xxx 补成完整的后端地址（同源时原样返回，本地开发零改动）
export function apiUrl(path) {
  const origin = serverOrigin();
  return origin ? origin + path : path;
}

export function saveServerOrigin(v) {
  try { globalThis.localStorage?.setItem('rt-server', normalizeServer(v)); } catch { /* 隐私模式忽略 */ }
}
