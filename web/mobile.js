// 王权窃贼 · 手游版增强
// 只做「触屏没有鼠标」这一件事：长按看牌面说明、松手/点别处收起、首次进入给一句提示。
// 出牌、宣告、战利品点选等交互全部由 app.js 的点击逻辑负责（点击事件在触屏上照常触发）。
import { showZoom, hideZoom } from './app.js';

const board = document.querySelector('.board');
const toastEl = document.getElementById('toast');
const HOLD_MS = 320;

let holdTimer = null;
let holding = false;
let tipTimer = null;

function tip(text, ms = 3400) {
  if (!toastEl) return;
  toastEl.textContent = text;
  toastEl.classList.remove('hidden');
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => toastEl.classList.add('hidden'), ms);
}

if (board) {
  board.addEventListener('touchstart', (ev) => {
    const card = ev.target && typeof ev.target.closest === 'function'
      ? ev.target.closest('[data-card],[data-secret]') : null;
    if (!card) return;
    holding = false;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => { holding = true; showZoom(card); }, HOLD_MS);
  }, { passive: true });

  board.addEventListener('touchmove', () => { clearTimeout(holdTimer); }, { passive: true });

  board.addEventListener('touchend', () => {
    clearTimeout(holdTimer);
    if (!holding) hideZoom();
    holding = false;
  }, { passive: true });

  board.addEventListener('touchcancel', () => {
    clearTimeout(holdTimer);
    holding = false;
    hideZoom();
  }, { passive: true });
}

// 长按看完牌之后再点一下 = 收起（否则这一下会落到牌上，容易误触）
if (typeof document.addEventListener === 'function') {
  document.addEventListener('touchstart', (ev) => {
    if (!toastEl) return;
    if (!toastEl.classList.contains('hidden')) toastEl.classList.add('hidden');
    if (holding) { hideZoom(); holding = false; }
  }, { passive: true, capture: true });
}

// 一些极简环境（例如 node 里的冒烟测试）没有全局事件，别让脚本挂掉
if (typeof globalThis.addEventListener === 'function') {
  globalThis.addEventListener('resize', hideZoom);
  globalThis.addEventListener('orientationchange', () => setTimeout(hideZoom, 260));
}

if (globalThis.__RT_MOBILE_TIP__ !== false) {
  globalThis.__RT_MOBILE_TIP__ = false;
  setTimeout(() => tip('长按任意卡牌可放大看说明 · 手牌左右滑动'), 900);
}