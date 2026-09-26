import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 从真实 index.html 收集 id 与 class：模拟层对不存在的元素直接报错，
// 因为真实浏览器里 getElementById 会返回 null，随后的赋值会整页崩掉。
const here = path.dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(path.join(here, '..', 'web', 'index.html'), 'utf8');
export const HTML_IDS = new Set([...HTML.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
export const HTML_CLASSES = new Set([...HTML.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
export class El {
  constructor(id = '') {
    this.id = id;
    this.dataset = {};
    this.children = [];
    this._html = '';
    this._text = '';
    this._handlers = {};
    this._classes = new Set();
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.classList = {
      add: (c) => this._classes.add(c),
      remove: (c) => this._classes.delete(c),
      contains: (c) => this._classes.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !this._classes.has(c) : Boolean(force);
        if (on) this._classes.add(c); else this._classes.delete(c);
        return on;
      },
    };
  }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text || this._html.replace(/<[^>]*>/g, ''); }
  addEventListener(type, fn) { (this._handlers[type] ??= []).push(fn); }
  fire(type, event) { for (const fn of this._handlers[type] ?? []) fn(event); }
  querySelector() { return new El('sub'); }
  closest() { return null; }
}

const els = new Map();
export const el = (id) => {
  if (!els.has(id)) els.set(id, new El(id));
  return els.get(id);
};
export const boardEl = new El('board');
export const tabsEl = new El('tabs');

export function installDom() {
  els.set('tabs', tabsEl);
  els.set('board', boardEl);
  el('modeSeg').children = ['ai', 'demo'].map((m) => {
    const b = new El(`mode-${m}`);
    b.dataset.mode = m;
    return b;
  });
  tabsEl.children = ['pub', 'priv'].map((k) => {
    const b = new El(`tab-${k}`);
    b.dataset.log = k;
    return b;
  });
  globalThis.document = {
    getElementById: (id) => {
      if (!HTML_IDS.has(id)) throw new Error(`index.html 里没有 id="${id}"（真实浏览器会返回 null 并报错）`);
      return el(id);
    },
    querySelector: (sel) => {
      const name = sel.replace(/^[.#]/, '');
      const known = sel.startsWith('.') ? HTML_CLASSES.has(name) : HTML_IDS.has(name);
      if (!known) throw new Error(`index.html 里没有选择器 "${sel}"`);
      return sel === '.board' ? boardEl : sel === '.tabs' ? tabsEl : el(name);
    },
  };
  globalThis.window = globalThis;
  return { el, boardEl, tabsEl };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 手牌现在是直接点：在 #handA / #handB 里找带 data-<key> 的那张明牌
function findInHand(key, faceName) {
  const re = new RegExp(`<div class="card[^>]*data-card="([^"]+)"[^>]*data-${key}="([^"]+)"[^>]*>`, 'g');
  for (const hid of ['handA', 'handB']) {
    for (const m of el(hid).innerHTML.matchAll(re)) {
      if (!faceName || m[0].includes(`data-face="${faceName}"`)) return { card: m[1], value: m[2], hid };
    }
  }
  return null;
}

export function handHas(key) { return Boolean(findInHand(key)); }

// 点手牌：牌桌上的点击监听在 .board 上，靠 closest('.card') 取 data-card
export function clickHandCard(key, faceName) {
  const hit = findInHand(key, faceName);
  if (!hit) return false;
  boardEl.fire('click', {
    target: { dataset: {}, closest: (sel) => (sel === '.card' ? { dataset: { card: hit.card } } : null) },
  });
  return true;
}

// 从当前 prompt HTML 里找出可点的 data- 属性并触发点击（模拟玩家点击）；
// prompt 里没有就去手牌里找（出牌、选出战牌、挑交换牌都直接点手牌）
export function clickPrompt(key) {
  const m = el('prompt').innerHTML.match(new RegExp(`data-${key}="([^"]+)"`));
  if (m) {
    el('prompt').fire('click', { target: { dataset: { [key]: m[1] }, closest: () => null } });
    return true;
  }
  return clickHandCard(key);
}

// 战利品二选一：点牌桌中央那张牌（data-reward="keep" / "take"）
export function clickReward(act = 'keep') {
  boardEl.fire('click', {
    target: { dataset: {}, closest: (sel) => (sel === '[data-reward]' ? { dataset: { reward: act } } : null) },
  });
}

// 按属性值点击：data-act="pass-declare" 这种用属性名会点错，所以按值匹配。
export function clickPromptValue(value) {
  const m = el('prompt').innerHTML.match(new RegExp(`(data-[a-z-]+)="${value}"`));
  if (!m) return false;
  const key = m[1].slice(5);
  el('prompt').fire('click', { target: { dataset: { [key]: value }, closest: () => null } });
  return true;
}