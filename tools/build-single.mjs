import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 把 src/ + web/ 打包成单个 HTML（双击即可玩，不需要服务器）。
// 做法：删掉 import / export 关键字后按依赖顺序拼接；所有模块顶层都是声明，
// web/app.js 末尾有顶层语句（启动），所以它必须放在最后。
// 端游版 → dist/王权窃贼.html ；手游版（多一层 mobile.css / mobile.js）→ dist/王权窃贼-手游.html
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

const CORE = [
  'src/rng.js', 'src/cards.js', 'src/rules.js', 'src/log.js',
  'src/view.js', 'src/redact.js', 'src/engine.js', 'src/bot.js', 'src/room.js',
  'web/session.js', 'web/face.js',
  'web/server-url.js', 'web/relay.js', 'web/remote.js', 'web/app.js',
];

const TARGETS = [
  {
    name: '端游版',
    shell: 'web/index.html',
    css: ['web/styles.css'],
    order: CORE,
    out: 'dist/王权窃贼.html',
    // 单文件版里 /web/xxx 这类绝对路径会失效，改成同目录下的另一个单文件
    rewrite: { '/web/mobile.html': './王权窃贼-手游.html' },
  },
  {
    name: '手游版',
    shell: 'web/mobile.html',
    css: ['web/styles.css', 'web/mobile.css'],
    order: [...CORE, 'web/mobile.js'],
    out: 'dist/王权窃贼-手游.html',
    rewrite: { '/web/index.html': './王权窃贼.html', '/web/mobile.html': './王权窃贼-手游.html' },
  },
];

function stripModuleSyntax(code, file) {
  const out = code
    .replace(/^\s*import[\s\S]*?from\s*['"][^'"]+['"];?/gm, '')
    .replace(/^\s*export\s+/gm, '');
  const leftover = out.match(/(^|\n)\s*(import|export)\s/);
  if (leftover) throw new Error(file + ' 里仍残留 import/export: ' + leftover[0].trim());
  return out.trimEnd();
}

function checkCollisions(order) {
  const seen = new Map();
  for (const f of order) {
    const code = stripModuleSyntax(read(f), f);
    for (const m of code.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      if (seen.has(m[1])) throw new Error('顶层重名声明 ' + m[1] + ' : ' + seen.get(m[1]) + ' 与 ' + f);
      seen.set(m[1], f);
    }
  }
}

function build(target) {
  checkCollisions(target.order);

  const bundle = [
    'globalThis.__SINGLE_FILE__ = true;',
    ...target.order.map((f) => '\n/* ===== ' + f + ' ===== */\n' + stripModuleSyntax(read(f), f)),
  ].join('\n');

  const css = target.css.map(read).join('\n');
  let shell = read(target.shell);
  const scriptTag = '<script type="module" src="/web/app.js"></script>';

  if (!shell.includes('<html lang="zh-CN">')) throw new Error('打包失败：外壳结构变了，找不到 <html lang="zh-CN">');
  if (!shell.includes(scriptTag)) throw new Error('打包失败：外壳结构变了，找不到 ' + scriptTag);

  shell = shell.replace('<html lang="zh-CN">', '<html lang="zh-CN" data-single-file>');
  for (const c of target.css) {
    const tag = '<link rel="stylesheet" href="/' + c + '" />';
    if (!shell.includes(tag)) throw new Error('打包失败：外壳结构变了，找不到 ' + tag);
    shell = shell.replace(tag, c === target.css[0] ? '<style>\n' + css + '\n</style>' : '');
  }
  shell = shell.replace(scriptTag, '<script type="module">\n' + bundle + '\n</script>');
  const mobileJs = '<script type="module" src="/web/mobile.js"></script>';
  if (shell.includes(mobileJs)) shell = shell.replace(mobileJs, '');

  for (const [from, to] of Object.entries(target.rewrite ?? {})) {
    shell = shell.split('"' + from + '"').join('"' + to + '"');
  }

  const left = shell.match(/(?:src|href)="\/web\/[^"]*"/g);
  if (left) {
    throw new Error('打包失败：外壳里仍有外部引用 ' + JSON.stringify(left));
  }
  mkdirSync(path.join(root, 'dist'), { recursive: true });
  const out = path.join(root, target.out);
  writeFileSync(out, shell, 'utf8');
  return { out: target.out, size: Buffer.byteLength(shell) / 1024, name: target.name };
}

const results = TARGETS.map(build);
for (const r of results) {
  console.log('已生成' + r.name + '单文件: ' + r.out + '（' + r.size.toFixed(1) + ' KB，双击即可玩）');
}