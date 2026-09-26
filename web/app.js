import { createSession } from './session.js';
import { createRemoteSession } from './remote.js';
import { createRelayHostSession, createRelayGuestSession } from './relay.js';
import { apiUrl, serverOrigin, saveServerOrigin, normalizeServer } from './server-url.js';
import { other } from '../src/engine.js';
import { RULES, BEATS, identityOf, compareIdentity } from '../src/rules.js';
import { faceOf, labelFace, cardDesc, secretDesc, cardHtml, backHtml, zoomHtml } from './face.js';

const $ = (id) => document.getElementById(id);
const PHASE_ORDER = ['draw', 'function', 'berserk', 'declare', 'battle', 'end'];
const PHASE_LABEL = { draw: '抽牌', function: '功能牌', berserk: '背水一战', declare: '对抗宣告', battle: '战斗结算', end: '回合结束' };
const PHASE_BANNER = {
  draw: ['抽牌阶段', '从主牌堆抽取 1 张'],
  function: ['功能牌阶段', '最多打出 1 张功能牌'],
  berserk: ['背水一战判定', '手牌仅剩 1 张人牌时可临时变身'],
  declare: ['对抗宣告', '双方同时暗置，提交后一次性翻开'],
  battle: ['战斗结算', '身份克制，胜者决定战利品'],
  end: ['回合结束', '清理临时状态'],
};

const ui = {
  s: null, mode: 'ai', gate: null, sel: {}, battle: null,
  logTab: 'pub', lastActor: null, busy: false, seq: 0, timer: null, timer2: null,
  botDelay: null, lastBannerKey: null, lastTurnKey: null, lastAskKey: null, fxOn: true, overBannerPending: false,
  peekTimer: null, seen: [], ask: false, fnShow: null, fnTimer: null,
  seat: null, room: null, lobbyErr: '', relayWanted: false,
};

globalThis.__RT_BOOTED__ = true;

function fatal(message, detail = '') {
  try {
    const box = document.getElementById('fatal');
    box.classList.remove('hidden');
    box.innerHTML = `<b>界面出错</b>：${message}${detail ? `<div class="fatal-detail">${detail}</div>` : ''}`;
  } catch { /* 诊断条本身失败就放弃 */ }
}

if (typeof globalThis.addEventListener === 'function') {
  globalThis.addEventListener('error', (e) => fatal(e.message || '脚本错误', '按 F12 打开控制台可看到完整堆栈'));
  globalThis.addEventListener('unhandledrejection', (e) => fatal(String(e.reason?.message ?? e.reason), '按 F12 打开控制台可看到完整堆栈'));
}
if (typeof location !== 'undefined' && location.protocol === 'file:' && !globalThis.__SINGLE_FILE__) {
  fatal('你是直接双击打开的 html 文件（file://）', '浏览器不允许 file:// 页面加载 ES 模块，所以界面会是空的、点不动。请在项目目录运行 <code>node server.mjs</code>，再访问 <code>http://localhost:8787/web/index.html</code>。');
}
/* ---------------- 飞牌动画 ---------------- */
let fxLayer = null;
function fxRoot() {
  if (!ui.fxOn) return null;
  if (typeof document.createElement !== 'function' || !document.body) return null;
  if (!fxLayer || !fxLayer.isConnected) {
    fxLayer = document.createElement('div');
    fxLayer.className = 'fx';
    document.body.appendChild(fxLayer);
  }
  return fxLayer;
}
const rectOf = (el) => (el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null);
const handEl = (who) => $(who === 'A' ? 'handA' : 'handB');

function fly(fromEl, toEl, inner, text) {
  const root = fxRoot();
  if (!root) return;
  const a = rectOf(fromEl);
  const b = rectOf(toEl);
  if (!a || !b || typeof a.left !== 'number') return;
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:0;top:0;width:60px;height:70px;will-change:transform';
  box.innerHTML = inner;
  root.appendChild(box);
  const sx = a.left + a.width / 2 - 30;
  const sy = a.top + a.height / 2 - 35;
  const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
  const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
  box.style.transform = `translate(${sx}px, ${sy}px)`;
  if (typeof box.animate !== 'function') { box.remove(); return; }
  const anim = box.animate([
    { transform: `translate(${sx}px, ${sy}px) scale(1.08) rotate(-7deg)`, opacity: .95 },
    { transform: `translate(${sx + dx * .55}px, ${sy + dy * .55 - 46}px) scale(1) rotate(5deg)`, opacity: 1, offset: .6 },
    { transform: `translate(${sx + dx}px, ${sy + dy}px) scale(.82) rotate(0deg)`, opacity: .9 },
  ], { duration: 430, easing: 'cubic-bezier(.3,.8,.4,1)' });
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    box.remove();
    if (text) popText(b, text);
  };
  anim.onfinish = finish;
  setTimeout(finish, 700);
}

function popText(r, text) {
  const root = fxRoot();
  if (!root || !r || typeof r.left !== 'number') return;
  const el = document.createElement('div');
  el.className = 'counter';
  el.style.left = `${r.left + r.width / 2 - 18}px`;
  el.style.top = `${r.top - 4}px`;
  el.textContent = text;
  root.appendChild(el);
  if (typeof el.animate !== 'function') { el.remove(); return; }
  const anim = el.animate([
    { opacity: 0, transform: 'translateY(8px)' },
    { opacity: 1, transform: 'none', offset: .25 },
    { opacity: 0, transform: 'translateY(-28px)' },
  ], { duration: 900, easing: 'ease-out' });
  anim.onfinish = () => el.remove();
  setTimeout(() => el.remove(), 1300);
}

/* ---------------- 环节横幅 ---------------- */
function banner(title, sub, kind) {
  const el = $('banner');
  if (!el || !title) return;
  if (el.dataset) el.dataset.kind = kind || '';
  $('bannerT').textContent = title;
  $('bannerS').textContent = sub || '';
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

/* ---------------- 桌面浮层弹窗（弹出即走，不留框不占位） ---------------- */
function popup(title, sub, kind) {
  if (!title || !canAnimate()) return;
  const root = $('popups');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'popup' + (kind ? ' k-' + kind : '');
  el.innerHTML = `<b>${title}</b>${sub ? `<i>${sub}</i>` : ''}`;
  // 只留最新一条：弹窗是「弹出即走」，同时叠两条就会糊在一起看不清
  for (const old of Array.from(root.children)) old.remove();
  root.appendChild(el);
  setTimeout(() => { el.remove(); }, 2200);
}

/* ---------------- 悬停放大 ---------------- */
export function showZoom(cardEl) {
  const z = $('zoom');
  if (!z || !cardEl) return;
  const secret = cardEl.dataset ? cardEl.dataset.secret === '1' : false;
  const name = cardEl.dataset ? cardEl.dataset.face : null;
  const face = secret ? null : (name ? labelFace(name) : null);
  $('zoomCard').innerHTML = secret ? backHtml('big') : zoomHtml(face);
  let title = '对手的手牌';
  let sub = '未知';
  let desc = secretDesc();
  const near = (sel) => (typeof cardEl.closest === 'function' ? cardEl.closest(sel) : null);
  if (!secret) {
    title = face.name;
    sub = face.sub || '';
    desc = cardDesc(face);
  } else if (near('#pileDeck')) {
    title = '主牌堆'; sub = '背面朝上';
    desc = RULES.revealDeckCount
      ? `还剩 ${$('deckCount').textContent} 张未抽。抽牌阶段从顶部抽 1 张，抽到皇冠且已有一张时会直接弃置。`
      : '张数默认不公开（重整条款：只告知抽到的牌，不提示牌堆剩余）。想对照观察可勾选顶栏的「牌堆张数」。';
  } else if (near('#pileDiscard')) {
    title = '弃牌堆'; sub = '本局不再使用';
    desc = `已经弃置 ${$('discardCount').textContent} 张。进入弃牌堆的牌本局不会再回到游戏。`;
  }
  const note = !secret && face.cls === 'func'
    ? '<div class="zk">（功能牌结算只提示“结算完成”，不会透露是否命中）</div>' : '';
  $('zoomInfo').innerHTML = `<div class="zt">${title}</div><div class="zs">${sub}</div>`
    + `<div class="zd">${desc}</div>` + note;
  const r = rectOf(cardEl);
  const zs = z.style;
  if (r && zs) {
    const boxW = 168 + 12 + 246;
    let left = r.left + r.width / 2 - boxW / 2;
    left = Math.max(10, Math.min(left, (window.innerWidth || 1200) - boxW - 10));
    let top = r.top - 214;
    if (top < 56) top = r.bottom + 12;
    zs.left = `${left}px`;
    zs.top = `${top}px`;
  }
  z.classList.remove('hidden');
  z.classList.add('show');
}
export function hideZoom() {
  const z = $('zoom');
  if (!z) return;
  z.classList.remove('show');
  z.classList.add('hidden');
}

/* ---------------- 窥探结果（洞若观火 / 重整）：只给当事人看 ---------------- */
function showPeek(ids, title) {
  const st = ui.s?.state;
  if (!st) return;
  const cards = ids.map((id) => st.cards[id]).filter(Boolean);
  if (!cards.length) return;
  const box = $('peekbox');
  if (!box) return;
  $('peekCard').innerHTML = cards.map((c) => cardHtml(faceOf(c))).join('');
  $('peekInfo').innerHTML = `<div class="pt">${title ?? '窥探结果'}</div>`
    + `<div class="pd">${cards.map((c) => cardDesc(faceOf(c))).join('<br>')}</div>`
    + '<div class="pn">只有你能看到这张牌，对手不会收到任何提示（本回合内可点姓名旁的 👁 回看）</div>';
  box.classList.remove('hidden');
  box.classList.add('show');
  clearTimeout(ui.peekTimer);
  ui.peekTimer = setTimeout(hidePeek, 5200);
}
function hidePeek() {
  clearTimeout(ui.peekTimer);
  const box = $('peekbox');
  if (!box) return;
  box.classList.remove('show');
  box.classList.add('hidden');
}

function toast(text) {
  const el = $('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(ui.timer2);
  ui.timer2 = setTimeout(() => el.classList.add('hidden'), 2800);
}
/* ---------------- 环节横幅队列（浏览器里逐条播放） ---------------- */
const bannerQ = [];
let bannerTimer = null;
const canAnimate = () => ui.fxOn && typeof document.createElement === 'function' && Boolean(document.body);

function queueBanner(title, sub, kind) {
  if (!canAnimate()) { banner(title, sub, kind); return; }
  bannerQ.push([title, sub, kind]);
  while (bannerQ.length > 3) bannerQ.shift();
  if (bannerTimer) return;
  drainBanner();
}
function drainBanner() {
  const next = bannerQ.shift();
  if (!next) { bannerTimer = null; return; }
  banner(next[0], next[1], next[2]);
  bannerTimer = setTimeout(() => { bannerTimer = null; drainBanner(); }, 780);
}

/* ---------------- 会话 ---------------- */
function currentViewer() {
  if (ui.mode === 'online') return ui.seat ?? 'A';
  if (ui.mode !== 'hotseat') return 'A';
  const actor = ui.s?.actor();
  return actor ?? ui.lastActor ?? 'A';
}

function resetLocalUi() {
  clearTimeout(ui.timer);
  clearTimeout(bannerTimer);
  if (ui.battle && ui.battle.timer) clearTimeout(ui.battle.timer);
  bannerQ.length = 0;
  bannerTimer = null;
  ui.sel = {}; ui.battle = null; ui.gate = null; ui.lastActor = null; ui.busy = false;
  ui.overBannerPending = false;
  ui.lastBannerKey = null;
  ui.lastTurnKey = null;
  ui.lastAskKey = null;
  ui.ask = false;
  if (fxLayer) fxLayer.innerHTML = '';
  const pops = $('popups');
  if (pops) pops.innerHTML = '';
  clearTimeout(ui.fnTimer);
  ui.fnShow = null;
}

function newGame(seed) {
  resetLocalUi();
  hideZoom();
  hidePeek();
  if (ui.mode === 'online') {
    // 联机：牌局在服务器上，本地只是把服务器下发的快照渲染出来
    $('seed').textContent = ui.room?.code ?? '—';
    if ($('seedLabel')) $('seedLabel').textContent = '房间';
    if (!ui.s?.ready) overlay(`<h2>正在进入房间…</h2><p>房间 ${ui.room?.code ?? ''} · 正在和服务器同步牌局</p>`);
    return;
  }
  ui.s = createSession({ seed: seed ?? Math.floor(Math.random() * 89999) + 10000, mode: ui.mode });
  ui.seq = ui.s.state.seq;
  $('seed').textContent = ui.s.seed;
  if ($('seedLabel')) $('seedLabel').textContent = '种子';
  hideOverlay();
  render();
}
function captureNewEvents() {
  const st = ui.s.state;
  const discard = $('pileDiscard');
  const deck = $('pileDeck');
  let story = null;
  let sawTurnStart = false;
  const ensureStory = () => (story ??= blankStory());
  for (const e of ui.s.eventsSince(ui.seq)) {
    const d = e.data ?? {};
    switch (e.type) {
      case 'draw':
        sawTurnStart = true;
        fly(deck, handEl(st.turn), backHtml(), '+1');
        queueBanner('抽牌阶段', `${st.turn} 从主牌堆抽入 1 张`);
        break;
      case 'draw-skip':
        sawTurnStart = true;
        queueBanner('抽牌阶段', '主牌堆已空，跳过抽牌');
        break;
      case 'play-function': {
        // 打出的能力牌先在判定区左右两个位置停一下（不要一出就飞走），1.2 秒后再进弃牌堆
        const who = d.player ?? st.turn;
        showFnCard(who, d.name);
        const doFly = () => fly(handEl(who), discard, cardHtml(labelFace(d.name)), `【${d.name}】`);
        if (canAnimate()) setTimeout(doFly, 1900); else doFly();
        break;
      }
      case 'penalty':
        if (d.passer && d.taker) fly(handEl(d.passer), handEl(d.taker), backHtml(), '−1');
        ensureStory().penalties.push({ passer: d.passer, taker: d.taker });
        break;
      case 'penalty-none':
        ensureStory().penalties.push({ none: true, text: e.text });
        break;
      case 'no-penalty':
        ensureStory().penalties.push({ free: true, text: e.text });
        break;
      case 'peek': {
        // 洞若观火：结果只给探查者看，对手那边什么都不显示（信息隐藏条款）
        const mine = ui.mode === 'demo' || e.player === currentViewer();
        if (mine) {
          if (d.seenId) showPeek([d.seenId], '洞若观火 · 你看到对手的 1 张牌');
          else toast('洞若观火：对手手牌为空，无效果');
        }
        break;
      }
      case 'regroup': {
        const mine = ui.mode === 'demo' || e.player === currentViewer();
        if (d.gotId) {
          if (mine) {
            fly(deck, handEl(e.player), cardHtml(faceOf(st.cards[d.gotId])), '重整');
            showPeek([d.gotId], '重整 · 从主牌堆抽到');
          }
        } else if (mine) {
          toast('重整：主牌堆里已经没有人牌，无效果');
        }
        break;
      }
      case 'swap':
        if (d.player && d.giveId && d.takeId) {
          fly(handEl(d.player), handEl(other(d.player)), cardHtml(labelFace(labelOf(st.cards[d.giveId]))), '→');
          fly(handEl(other(d.player)), handEl(d.player), cardHtml(labelFace(labelOf(st.cards[d.takeId]))), '←');
        }
        toast(e.text ?? '交换结算完成');
        break;
      case 'battle-reveal':
        story = { ...blankStory(), reveal: d };
        break;
      case 'thief-cloak':
        if (story) story.cloaks.push(d.side);
        fly($('slot' + d.side), discard, cardHtml(labelFace('隐身衣')), '弃置');
        break;
      case 'thief-steal':
        if (story) story.steals.push(d);
        fly($('slot' + other(d.side)), handEl(d.side), cardHtml(labelFace('武器')), d.stolen ? '夺取' : '无武器');
        toast(e.text ?? '贼效果结算完成');
        break;
      case 'battle-win':
        if (story) story.result = { kind: 'win', winner: d.winner, ia: d.ia, ib: d.ib };
        break;
      case 'battle-draw':
        if (story) story.result = { kind: 'draw', ia: d.ia, ib: d.ib };
        break;
      case 'battle-skipped':
        if (story) story.result = { kind: 'skip' };
        break;
      case 'reward':
        if (d.option) {
          const tgt = story ?? ui.battle?.story;
          if (tgt) tgt.choice = d.option;
        }
        break;
      case 'battle-settled':
        if (story) story.settled = true;
        else if (ui.battle) ui.battle.story.settled = true;
        break;
      case 'crown-overflow':
        fly(handEl(d.player), discard, cardHtml(labelFace('皇冠')), '溢出');
        toast(e.text ?? `${d.player} 皇冠超出上限，直接弃入弃牌堆`);
        break;
      case 'zhige':
        queueBanner('止戈', `${d.player ?? st.turn} 打出止戈，跳过宣告与战斗`);
        toast('此回合止戈生效，跳过宣告与战斗');
        break;
      case 'game-over':
        ui.overBannerPending = true;
        break;
      default:
        break;
    }
  }
  ui.seq = ui.s.state.seq;
  if (story) startBattle(story);
  else if (sawTurnStart && !battleBusy()) ui.battle = null;
  drainGameOverBanner();
}

const labelOf = (card) => (card.kind === 'person' ? `人(${card.align})` : card.name);

function step(fn) {
  // 提交完就换人：清掉遮屏、把「刚操作过的人」记成当前行动者，
  // 这样下一次 actor 变化时才会重新遮屏（否则会出现 A 操作完却还显示「交给 A」）
  if (ui.mode === 'hotseat') {
    ui.lastActor = ui.s?.actor() ?? ui.lastActor;
    ui.gate = null;
  }
  fn();
  // 联机：指令已经发给服务器，等它把新快照推回来再走动画与渲染
  if (ui.mode === 'online') return;
  captureNewEvents();
  render();
}

function pump() {
  if (!ui.s || ui.gate || ui.busy || battleBusy() || ui.s.state.winner) return;
  const actor = ui.s.actor();
  if (!actor || !ui.s.isBot(actor)) return;
  ui.busy = true;
  ui.timer = setTimeout(() => {
    ui.busy = false;
    try {
      if (!ui.s || ui.s.state.winner || ui.gate) return;
      const who = ui.s.actor();
      if (!who || !ui.s.isBot(who)) return;
      const cmd = ui.s.botCommand(who);
      if (cmd) step(() => ui.s.act(who, cmd));
      else render();
    } catch (err) {
      fatal(`机器人行动时出错：${err.message}`, String(err.stack ?? ''));
    }
  }, ui.botDelay ?? (ui.mode === 'demo' ? 820 : 600));
}

function render() {
  if (!ui.s) return;
  const st = ui.s.state;
  const actor = ui.s.actor();
  if (ui.mode === 'hotseat' && !st.winner && actor && ui.gate !== actor && actor !== ui.lastActor) ui.gate = actor;
  const gated = Boolean(ui.gate) && !st.winner;
  if (!gated) renderTable();
  renderStatus();
  renderLog();
  if (st.winner && !battleBusy()) { showGameOver(); return; }
  if (gated) { showGate(ui.gate); return; }
  pump();
}
/* ---------------- 牌桌渲染 ---------------- */
function actorIs(who) {
  return ui.s?.actor() === who;
}

function renderTable() {
  const st = ui.s.state;
  const viewer = currentViewer();
  const god = ui.mode === 'demo';
  const p = st.pending;

  for (const who of ['A', 'B']) {
    const hand = st.players[who].hand;
    const self = god || who === viewer;
    const isActor = actorIs(who);
    const el = handEl(who);
    let html = '';
    if (self) {
      hand.forEach((id, i) => {
        const c = st.cards[id];
        const extra = [];
        // 出牌一律直接点手牌：可点的牌在这里挂上 data-*，提示条只留动作按钮
        const attrs = [`data-card="${id}"`, `style="animation-delay:${i * 40}ms"`];
        if (isActor && p?.kind === 'function-phase' && !p.submitted.includes(who)) {
          if (ui.sel.giveFor) {
            if (c.id === ui.sel.giveFor) extra.push('selected');
            else if (c.kind === 'function') extra.push('dimmed');
            else { extra.push('picking'); attrs.push(`data-give="${id}"`); }
          } else if (c.kind === 'function') {
            extra.push('playable'); attrs.push(`data-play="${id}"`);
          } else extra.push('dimmed');
        } else if (isActor && p?.kind === 'declare-phase' && !p.submitted.includes(who)) {
          if (ui.sel.personId === id || ui.sel.itemId === id) extra.push('selected');
          else if (c.kind === 'person' || c.kind === 'item') extra.push('playable');
          else extra.push('dimmed');
          if (c.kind === 'person') attrs.push(`data-person="${id}"`);
          if (c.kind === 'item') attrs.push(`data-item="${id}"`);
        }
        html += cardHtml(faceOf(c), extra.join(' '), attrs.join(' '));
      });
    } else {
      const shown = hand.length === 0 ? 1 : (RULES.revealHandCounts ? hand.length : 3);
      html = Array.from({ length: shown }, () => backHtml()).join('');
      if (!RULES.revealHandCounts) html += '<span class="stackmany">数量未知</span>';
    }
    el.innerHTML = html;
    const known = god || self || RULES.revealHandCounts;
    el.classList.toggle('empty', self && hand.length === 0);
    // 张数不公开时也不要用「缩略尺寸」间接暴露手牌多少（背面牌会跟着变小）
    el.classList.toggle('compact', known && hand.length > 7);
    el.classList.toggle('tiny', known && hand.length > 11);
    $(who === 'A' ? 'countA' : 'countB').textContent = known ? String(hand.length) : '?';

    const tags = [];
    if (p?.kind === 'declare-phase' && p.submitted.includes(who)) tags.push('<span class="tag act">已锁定宣告</span>');
    if (st.turn === who && !st.winner) tags.push('<span class="tag act">行动中</span>');
    if (self && st.players[who].silenced) tags.push('<span class="tag warn">被沉默</span>');
    if (self && st.berserk[who]) tags.push('<span class="tag warn">背水一战</span>');
    // 本回合窥探过的牌：点一下回看（洞若观火条款允许本回合内回看）
    if (self) {
      const seen = ui.s.view(who).yourSeenThisTurn ?? [];
      if (seen.length) tags.push(`<span class="tag peek" data-act="peek-view">👁 已窥探 ${seen.length} 张 · 点我回看</span>`);
    }
    $(who === 'A' ? 'tagsA' : 'tagsB').innerHTML = tags.join('');
  }

  if (ui.mode === 'online') {
    $('nameA').textContent = ui.seat === 'A' ? '玩家 A（你）' : '玩家 A（对手）';
    $('nameB').textContent = ui.seat === 'B' ? '玩家 B（你）' : '玩家 B（对手）';
  } else {
    $('nameA').textContent = ui.mode === 'ai' ? '玩家 A（你）' : '玩家 A';
    $('nameB').textContent = ui.mode === 'hotseat' ? '玩家 B' : '玩家 B（电脑）';
  }

  renderPiles(st);
  renderArena();
}

function renderPiles(st) {
  const deckN = st.deck.length;
  // 张数不公开时，牌堆一律画满 8 层，免得「层数变少」间接暴露剩余张数
  const deckLayers = deckN === 0 ? 0 : (RULES.revealDeckCount ? Math.min(8, deckN) : 8);
  $('deckStack').innerHTML = Array.from({ length: deckLayers }, (_, i) =>
    `<div class="layer" style="--i:${i}">${backHtml()}</div>`).join('');
  $('deckCount').textContent = RULES.revealDeckCount ? String(deckN) : (deckN === 0 ? '0' : '?');
  $('pileDeck').classList.toggle('empty', deckN === 0);

  const disc = st.discard;
  const topN = Math.min(3, disc.length);
  let dhtml = '';
  for (let i = 0; i < topN; i++) {
    const id = disc[disc.length - topN + i];
    const isTop = i === topN - 1;
    const inner = RULES.revealDiscard && isTop ? cardHtml(faceOf(st.cards[id])) : backHtml();
    dhtml += `<div class="layer" style="--i:${i}">${inner}</div>`;
  }
  $('discardStack').innerHTML = dhtml;
  $('discardCount').textContent = String(disc.length);
  $('pileDiscard').classList.toggle('empty', disc.length === 0);
}

const sideName = (who) => (ui.mode === 'online'
  ? (who === ui.seat ? '你' : '对手')
  : ui.mode === 'ai' ? (who === 'A' ? '你' : '电脑') : '玩家 ' + who);

// 打出的能力牌在判定区停留（谁打了一看就知道是谁的）
function showFnCard(who, name) {
  ui.fnShow = ui.fnShow ?? {};
  ui.fnShow[who] = name;
  clearTimeout(ui.fnTimer);
  if (!canAnimate()) return;
  ui.fnTimer = setTimeout(() => { ui.fnShow = null; if (ui.s && !ui.s.state.winner) render(); }, 3200);
}

function fnSlotHtml(who, shown, submitted) {
  const name = sideName(who);
  if (shown) return cardHtml(labelFace(shown)) + `<span class="badge">${name} · ${shown}</span>`;
  if (submitted) return backHtml('flip') + `<span class="badge">${name} · 已暗置</span>`;
  return `<div class="card ghost"></div><span class="badge quiet">${name} · 待出牌</span>`;
}

function renderFnArena(p) {
  $('arenaTitle').textContent = '能力牌';
  const me = currentViewer();
  const leftWho = ui.mode === 'demo' ? 'A' : other(me);
  const rightWho = ui.mode === 'demo' ? 'B' : me;
  const sub = p.submitted ?? [];
  $('slotA').innerHTML = fnSlotHtml(leftWho, ui.fnShow?.[leftWho], sub.includes(leftWho));
  $('slotB').innerHTML = fnSlotHtml(rightWho, ui.fnShow?.[rightWho], sub.includes(rightWho));
  $('verdict').innerHTML = sub.length === 0 ? '双方同时暗置，各出最多 1 张'
    : sub.length === 1 ? '已提交 1/2，等另一方' : '双方都已提交';
}

function renderArena() {
  const st = ui.s.state;
  const p = st.pending;
  const slotA = $('slotA');
  const slotB = $('slotB');
  if (ui.battle && p?.kind !== 'declare-phase') { drawBattle(); return; }
  if (p?.kind === 'function-phase' || (!p && ui.fnShow)) { renderFnArena(p ?? { submitted: [] }); return; }
  const me = currentViewer();
  const leftWho = ui.mode === 'demo' ? 'A' : other(me);
  const rightWho = ui.mode === 'demo' ? 'B' : me;
  const declared = p?.kind === 'declare-phase' ? p.submitted : [];
  const side = (who) => (declared.includes(who)
    ? `${backHtml('flip')}<span class="badge">${sideName(who)} · 已锁定</span>`
    : `<div class="card ghost"></div><span class="badge quiet">${sideName(who)} · 待宣告</span>`);
  const preview = comboPreview();
  slotA.innerHTML = side(leftWho);
  if (preview) {
    slotB.innerHTML = preview;
    $('arenaTitle').textContent = '你的出战组合';
    $('verdict').innerHTML = '点这张牌可拆开重选';
  } else {
    slotB.innerHTML = side(rightWho);
    $('arenaTitle').textContent = '对抗宣告';
    $('verdict').innerHTML = declared.length === 0 ? '双方同时暗置' : `已提交 ${declared.length}/2`;
  }
}

/* ---------------- 出战组合预览（人牌 + 道具自动合成身份，可再点拆开） ---------------- */
function comboPreview() {
  const st = ui.s.state;
  const actor = ui.s.actor();
  if (!actor || ui.mode === 'demo') return '';
  if (currentViewer() !== actor) return '';
  const sel = ui.sel;
  const person = sel.personId ? st.cards[sel.personId] : null;
  const item = sel.itemId ? st.cards[sel.itemId] : null;
  if (!person && !item) return '';
  let id = null;
  if (person) id = identityOf({ person, item }, Boolean(st.berserk[actor]));
  const cards = [person, item].filter(Boolean)
    .map((c) => cardHtml(faceOf(c), 'flip', `data-card="${c.id}"`)).join('');
  const merged = id ? `已合成 <b>${id}</b>` : '再选一张人牌才能出战';
  const zhan = id && !item && st.berserk[actor] ? '（背水一战临时变身，仅你可见）' : '';
  return `<div class="side"><div class="sidecards">${cards}</div>`
    + `<div class="sideid">${id ?? '待定'}</div>`
    + `<div class="hint">${merged}${zhan}</div></div>`;
}

/* ---------------- 战斗判定播放（分段放慢，逐条讲清） ---------------- */
const BTL_MS = { reveal: 1100, thief: 1750, ident: 1700, settle: 1250, skip: 1300 };
const BTL_DOTS = '①②③④⑤⑥';
const BTL_TITLE = {
  reveal: '同时亮牌',
  thief: '贼效果优先结算',
  ident: '身份克制判定',
  settle: '战利品处理',
  skip: '跳过战斗结算',
};

function blankStory() {
  return { reveal: null, cloaks: [], steals: [], result: null, penalties: [], choice: null, settled: false };
}

function battleSteps(story) {
  if (!story.reveal) return ['skip'];
  const steps = ['reveal'];
  if (story.cloaks.length) steps.push('thief');
  steps.push('ident', 'settle');
  return steps;
}

function battleBusy() { return Boolean(ui.battle && ui.battle.timer); }

function startBattle(story) {
  if (ui.battle && ui.battle.timer) clearTimeout(ui.battle.timer);
  ui.battle = { story, steps: battleSteps(story), t: 0, timer: null };
  queueBanner('战斗结算', '逐条判定，点牌桌中央可快进');
  if (!canAnimate()) { ui.battle.t = ui.battle.steps.length - 1; return; }
  ui.battle.timer = setTimeout(tickBattle, BTL_MS[ui.battle.steps[0]] ?? 1200);
}

function tickBattle() {
  const b = ui.battle;
  if (!b) return;
  b.timer = null;
  if (b.t >= b.steps.length - 1) { finishBattle(); return; }
  b.t += 1;
  renderArena();
  b.timer = setTimeout(tickBattle, BTL_MS[b.steps[b.t]] ?? 1200);
}

function finishBattle() {
  if (ui.battle) ui.battle.timer = null;
  if (!ui.s) return;
  render();
  drainGameOverBanner();
}

function drainGameOverBanner() {
  if (!ui.overBannerPending || battleBusy()) return;
  ui.overBannerPending = false;
  bannerQ.length = 0;
  const w = ui.s?.state?.winner;
  queueBanner('对局结束', w ? w.reason : '');
}

// 战利品二选一：轮到自己选时，把两张出战牌变成「点你要留下的那张」
// （点 = 选中并变亮放大，真正的提交在提示里的「确认选择」）
function rewardPick() {
  if (battleBusy()) return null;
  const st = ui.s?.state;
  const p = st?.pending;
  if (p?.kind !== 'battle-reward') return null;
  const actor = ui.s.actor();
  if (!actor) return null;
  if (p.winner !== actor) return null;
  if (ui.s.isBot(actor)) return null;
  if (currentViewer() !== actor) return null;
  return { winner: p.winner, loser: other(p.winner) };
}

function drawBattle() {
  const b = ui.battle;
  const story = b.story;
  const cur = b.steps[b.t];
  const reached = (k) => b.steps.includes(k) && b.t >= b.steps.indexOf(k);
  const arena = $('arena');
  arena.classList.toggle('clash', cur === 'ident');
  arena.classList.toggle('thieving', cur === 'thief');
  arena.classList.toggle('settling', cur === 'settle');
  $('arenaTitle').textContent = `战斗结算 · ${BTL_TITLE[cur] ?? ''}`;
  if (b.t < b.steps.length - 1) $('arenaTitle').textContent += '（点击此处快进）';
  const pick = story.result && story.result.kind === 'win' ? rewardPick() : null;
  arena.classList.toggle('choosing', Boolean(pick));
  const sideHtml = (who, html) => {
    if (!pick) return html;
    const act = who === pick.winner ? 'keep' : 'take';
    const on = ui.sel.reward === act ? ' on' : '';
    const tip = act === 'keep' ? '① 留这张' : '② 收这张';
    return `<div class="pickwrap${on}" data-reward="${act}">${html}`
      + `<span class="pickhint">${ui.sel.reward === act ? '已选 · ' + tip : tip}</span></div>`;
  };
  const me = currentViewer();
  const leftWho = ui.mode === 'demo' ? 'A' : other(me);
  const rightWho = ui.mode === 'demo' ? 'B' : me;
  if (!story.reveal) {
    $('slotA').innerHTML = '<div class="card ghost"></div>';
    $('slotB').innerHTML = '<div class="card ghost"></div>';
  } else {
    $('slotA').innerHTML = sideHtml(leftWho, revealSide(story.reveal[leftWho], leftWho, story, reached));
    $('slotB').innerHTML = sideHtml(rightWho, revealSide(story.reveal[rightWho], rightWho, story, reached));
  }
  $('verdict').innerHTML = `<div class="btl">${battleLines(story, b.steps, b.t)}</div>`;
}

function battleLines(story, steps, t) {
  const k = steps[Math.max(0, Math.min(t, steps.length - 1))];
  return `<div class="btl-seg cur">`
    + `<div class="btl-step">${BTL_DOTS[t] ?? '·'} ${BTL_TITLE[k] ?? ''}</div>`
    + `<div class="btl-body">${stepBody(k, story)}</div></div>`;
}

const comboTxt = (c) => (!c || !c.fight ? '不出战' : c.person + (c.item ? ' + ' + c.item : ''));

function stepBody(k, story) {
  const r = story.reveal;
  if (k === 'skip') {
    const rows = story.penalties.map((x) => (x.passer && x.taker
      ? `<span class="to-hand">${x.taker} 随机夺走 ${x.passer} 手牌里的 1 张</span>`
      : `<span class="to-zone">${x.text ?? '未形成双方对战'}</span>`));
    return rows.join('') || '<span class="to-zone">双方都没出战</span>';
  }
  if (k === 'reveal') {
    return `<span class="ln">${sideName('A')} <b>${r.A.identity}</b>（${comboTxt(r.A)}）　${sideName('B')} <b>${r.B.identity}</b>（${comboTxt(r.B)}）</span>`;
  }
  if (k === 'thief') {
    const rows = story.cloaks.map((who) => {
      const s = story.steals.find((x) => x.side === who);
      const extra = !s ? ''
        : s.stolen
          ? `<span class="to-hand">并夺走 ${s.from} 出战组合里的武器 → ${who} 的手牌</span>`
          : '<span class="to-zone">对手出战组合里没有武器，夺不到</span>';
      return `<span class="ln">${who} 弃掉隐身衣</span>${extra}`;
    });
    return rows.join('');
  }
  if (k === 'ident') {
    const cmp = compareIdentity(r.A.identity, r.B.identity);
    let main;
    if (cmp === 'draw') {
      main = `<span class="ln"><b>${r.A.identity}</b> 与 <b>${r.B.identity}</b> 互不克制 → <b>平局</b></span>`;
      if (r.A.identity === '贼' || r.B.identity === '贼') main += '<span class="k">贼对任何身份都是平局</span>';
    } else {
      const w = cmp === 'a' ? 'A' : 'B';
      const wv = cmp === 'a' ? r.A.identity : r.B.identity;
      const lv = cmp === 'a' ? r.B.identity : r.A.identity;
      main = `<span class="ln"><b>${sideName(w)}</b> 胜出：<b>${wv}</b> <span class="k">克制</span> <b>${lv}</b></span>`;
    }
    return main;
  }
  if (k === 'settle') {
    const res = story.result;
    if (!res) return '<span class="to-zone">等待结算…</span>';
    if (res.kind === 'draw') {
      return RULES.drawDiscardsBattleCards
        ? '<span class="to-discard">双方出战卡牌全部进入弃牌堆</span>'
        : '<span class="to-hand">双方出战卡牌全部返还各自手牌</span>';
    }
    const w = res.winner;
    const l = other(w);
    if (!story.choice) return '<span class="to-zone">等待胜者二选一：保留自己的，或收下对手的…</span>';
    return story.choice === 'keep'
      ? `<span class="to-hand">${w} 保留自己的出战牌（${comboTxt(r[w])}）→ 回到手牌</span>`
        + `<span class="to-discard">${l} 的出战牌（${comboTxt(r[l])}）→ 弃牌堆</span>`
      : `<span class="to-discard">${w} 弃掉自己的出战牌（${comboTxt(r[w])}）→ 弃牌堆</span>`
        + `<span class="to-hand">${l} 的出战牌（${comboTxt(r[l])}）→ ${w} 收入手牌</span>`;
  }
  return '';
}

function revealSide(d, who, story, reached) {
  if (!d || !d.fight) return `<div class="card ghost"></div><span class="badge">${who} · 不出战</span>`;
  const gone = Boolean(story) && (
    (story.cloaks.includes(who) && reached('thief'))
    || (reached('thief') && story.steals.some((s) => s.stolen && s.from === who)));
  const res = story ? story.result : null;
  // 克制判定出结果后，赢的一方金光上浮，输的一方压暗下沉
  const judged = Boolean(story) && reached('ident') && res && res.kind === 'win';
  const win = judged && res.winner === who;
  const lose = judged && res.winner !== who;
  const tag = win ? ' bwin' : lose ? ' blose' : '';
  const cls = d.identity === '贼' ? 'winner-glow' : '';
  return cardHtml(labelFace(d.person), `flip ${cls}${tag}`)
    + (d.item ? cardHtml(labelFace(d.item), `flip${gone ? ' dimmed' : ''}${tag}`) : '')
    + `<span class="badge${win ? ' won' : lose ? ' lost' : ''}">${sideName(who)} · ${d.identity}</span>`;
}
/* ---------------- 顶栏 / 操作区 ---------------- */
function bannerKey(st, p, actor) {
  if (st.winner) return null;
  if (p?.kind === 'function-phase') return `fn:${st.round}:${actor}`;
  if (p?.kind === 'declare-phase') return `decl:${st.round}:${st.turn}`;
  if (p?.kind === 'battle-reward') return `reward:${st.round}:${p.winner}`;
  return null;
}

function renderStatus() {
  const st = ui.s.state;
  const actor = ui.s.actor();
  const viewer = currentViewer();
  const v = ui.s.view(viewer);
  const p = st.pending;

  const active = p?.kind === 'function-phase' ? 'function'
    : p?.kind === 'declare-phase' ? 'declare'
    : p?.kind === 'battle-reward' ? 'battle'
    : st.phase;
  const idx = PHASE_ORDER.indexOf(active);
  $('phasebar').innerHTML = PHASE_ORDER.map((ph, i) => {
    const cls = ph === active ? 'ph on' : i < idx ? 'ph done' : 'ph';
    return `<div class="${cls}">${PHASE_LABEL[ph]}</div>`;
  }).join('');

  const turnName = st.winner ? '对局结束'
    : ui.mode === 'online' ? (st.turn === ui.seat ? '轮到你' : '等待对手…')
    : ui.mode === 'ai' && actor === 'B' ? '电脑正在行动…'
    : ui.mode === 'demo' ? '自动观战中…'
    : `${actor ?? '—'} 行动`;
  const bits = [`第 ${st.round} 回合`, turnName];
  if (st.atWarCounter > 0) bits.push(`止戈 ${st.atWarCounter}/${RULES.zhiGeGoal}`);
  if (st.deck.length === 0) bits.push('主牌堆已空');
  $('turnbar').innerHTML = bits.join(' · ');

  if ($('btnInvite')) $('btnInvite').classList.toggle('hidden', !(ui.mode === 'online' && ui.room?.code));

  const mine = Boolean(actor) && !ui.s.isBot(actor);
  $('prompt').classList.toggle('mine', mine);
  $('prompt').innerHTML = promptHtml(actor, v, p);
  // 台面提示：只有「需要你点选」的决策点才浮到牌桌中央、贴着手牌（三国杀式「请出一张角色牌」），
  // 底栏只剩回合状态与说明，不再一条条堆着。是否浮起由 promptHtml 设的 ui.ask 决定
  // （电脑行动 / 观战 / 等待对手这类状态提示不浮）
  $('prompt').classList.toggle('dock', Boolean(ui.ask));
  // 判定播放时把竞技场从「框」里放出来，卡片放大、文字让位
  $('arena').classList.toggle('battle', Boolean(ui.battle && p?.kind !== 'declare-phase'));

  // 回合转换提示：换人先报「轮到谁」，再报这一回合要走的环节
  // 判定动画正在逐条播放时先不发横幅，免得「战利品处理」提前盖在「身份克制判定」上；
  // 这时也不能把 key 记成「已发过」，否则这一条横幅会被永久吞掉（等判定播完再补发）
  const canBanner = !battleBusy();
  const tKey = st.winner ? null : `turn:${st.round}:${st.turn}`;
  if (canBanner && tKey && tKey !== ui.lastTurnKey) {
    ui.lastTurnKey = tKey;
    const who = ui.mode === 'online' ? (st.turn === ui.seat ? '你的回合' : '对手的回合')
      : ui.mode === 'ai' ? (st.turn === 'A' ? '你的回合' : '电脑的回合')
      : `玩家 ${st.turn} 的回合`;
    const sub = ui.mode === 'demo' ? `第 ${st.round} 回合 · 自动演示`
      : `第 ${st.round} 回合 · 抽牌 → 功能牌 → 宣告 → 结算`;
    queueBanner(who, sub, 'turn');
  }

  // 桌面浮层提示：该你操作时在牌桌上弹一条，弹出即走，不常驻、不占位
  const askKey = ui.ask ? (ui.sel.giveFor ? 'give' : p.kind) + ':' + actor : null;
  if (canBanner && askKey && askKey !== ui.lastAskKey) {
    ui.lastAskKey = askKey;
    const spec = {
      'function-phase': '请打出一张能力牌',
      'declare-phase': '请出一道角色牌',
      'battle-reward': '请点一张你要留下的牌',
      'give': '请选择一张你要交换的手牌',
    }[ui.sel.giveFor ? 'give' : p.kind];
    if (spec) popup(spec, '', 'action');
  }

  // 阶段提示统一交给「桌面浮层弹窗」发（下面那段），这里不再重复发一条横幅，
  // 免得牌桌中央同时堆三条一模一样的字。
  ui.lastBannerKey = bannerKey(st, p, actor);
}

const askTitle = (t, sub) => `<div class="askt"><b>${t}</b>${sub ? `<i>${sub}</i>` : ''}</div>`;

function promptHtml(actor, v, p) {
  // 是否把这条提示浮到牌桌中央（只有真正需要玩家点选的决策点才会设成 true）
  ui.ask = false;
  if (!p) return '<span class="hint">结算中…</span>';
  if (ui.mode === 'demo') {
    return '<span class="plabel">观战</span><span class="hint">双方都由电脑操作，无需点击。想自己玩请点顶部「人机」或「双人」。</span>';
  }
  const isBotTurn = Boolean(actor) && ui.s.isBot(actor);
  if (p.kind === 'function-phase') {
    // 能力牌阶段是【双方同时暗置】：自己交了就等对手，两边都交完才依次结算
    if (v.pending.youSubmitted && !ui.sel.giveFor) {
      return '<span class="hint">已暗置提交能力牌 · 等待对手提交…（无需点击）</span>';
    }
    if (ui.sel.giveFor) {
      ui.ask = true;
      return askTitle('请选择一张你要交换的手牌', '点手牌里任意一张非能力牌')
        + '<button class="act secondary" data-act="cancel-give">取消 · 不交换</button>';
    }
    if (isBotTurn) return '<span class="hint">电脑正在暗置能力牌…</span>';
    const playable = v.pending.playable ?? [];
    ui.ask = true;
    if (!playable.length) {
      return askTitle('请打出一张能力牌', '手上没有能力牌')
        + '<button class="act secondary" data-act="pass">跳过 · 不打出功能牌</button>';
    }
    return askTitle('请打出一张能力牌', '点亮起来的能力牌即可打出')
      + '<button class="act secondary" data-act="pass">跳过 · 不打出功能牌</button>';
  }
  if (p.kind === 'declare-phase') {
    if (v.pending.youSubmitted) {
      return '<span class="hint">已锁定本回合宣告 · 等待对手暗置…（无需点击）</span>';
    }
    if (isBotTurn) return '<span class="hint">电脑正在暗置宣告…（无需点击）</span>';
    const sel = ui.sel;
    ui.ask = true;
    return (v.yourBerserkEligible
      ? '<span class="hint warn">背水一战成立 · 出战将临时变身（仅你可见）</span>' : '')
      + askTitle('请出一道角色牌', sel.personId ? '可再点亮 1 张道具合成身份' : '点亮起来的人牌，可搭配 1 张道具')
      + `<button class="act" data-act="fight" ${sel.personId ? '' : 'disabled'}>出战（暗置提交）</button>`
      + '<button class="act secondary" data-act="pass-declare">不出战</button>';
  }
  if (p.kind === 'battle-reward') {
    if (p.winner !== actor) return '<span class="plabel">战利品</span><span class="hint">等待对手选择出战卡牌的处理方式…</span>';
    if (isBotTurn) return '<span class="plabel">战利品</span><span class="hint">电脑正在决定…</span>';
    const pick = ui.sel.reward ?? null;
    ui.ask = true;
    return askTitle(pick ? '确认你的选择' : '请点一张你想留下的牌', '')
      + (pick === 'keep' ? '<span class="pickline on">① 留下我的出战牌</span>'
        : pick === 'take' ? '<span class="pickline on">② 留下对手的出战牌</span>'
        : '<span class="pickline">点牌桌上你要留下的那张</span>')
      + `<button class="act" data-act="reward-ok" ${pick ? '' : 'disabled'}>确认选择</button>`
      + (pick ? '<button class="act secondary" data-act="reward-reset">重选</button>' : '');
  }
  return '';
}

function renderLog() {
  const v = ui.s.view(currentViewer());
  const lines = ui.logTab === 'pub'
    ? v.publicLog.map((t) => ({ t, cls: '' }))
    : v.privateLog.map((t) => ({ t, cls: 'lv-private' }));
  const el = $('log');
  el.innerHTML = lines.length
    ? lines.map((l) => `<div class="${l.cls}">${l.t}</div>`).join('')
    : '<span class="hint">暂无</span>';
  el.scrollTop = el.scrollHeight;
}
/* ---------------- 遮罩面板 ---------------- */
function overlay(html) {
  $('ovcard').innerHTML = html;
  $('overlay').classList.remove('hidden');
}
function hideOverlay() {
  $('overlay').classList.add('hidden');
}
function showGate(who) {
  overlay(`<h2>请将设备交给${who === 'A' ? '玩家 A' : '玩家 B'}</h2>
    <p>本回合由你私密操作（手牌、背水一战、暗置宣告都不能让对方看到）。</p>
    <div class="btnrow"><button class="act" data-act="ready">我准备好了</button></div>`);
}
function showGameOver() {
  const st = ui.s.state;
  const w = st.winner;
  if (!w) return;
  const hand = (who) => st.players[who].hand
    .map((id) => cardHtml(faceOf(st.cards[id]))).join('') || '<span class="hint">（空）</span>';
  overlay(`<h2>${w.kind === 'draw' ? '平局' : `${w.id} 胜`}</h2>
    <p>${w.reason}</p>
    <div class="reveal-row">
      <div class="reveal-col"><h4>玩家 A 手牌</h4><div class="hands">${hand('A')}</div></div>
      <div class="reveal-col"><h4>玩家 B 手牌</h4><div class="hands">${hand('B')}</div></div>
    </div>
    <div class="btnrow">
      ${ui.mode === 'online'
        ? '<button class="act" data-act="online-rematch">再来一局（两边同时重开）</button>'
        : '<button class="act" data-act="again">再来一局</button>'}
      <button class="act secondary" data-act="close">查看牌桌</button>
      <button class="act secondary" data-act="menu">回到主界面</button>
    </div>`);
}
/* ---------------- 主界面 ---------------- */
function syncModeSeg() {
  for (const b of $('modeSeg').children) b.classList.toggle('on', b.dataset.mode === ui.mode);
}
function showMenu() {
  syncModeSeg();
  const cur = ui.mode === 'demo' ? '自动观战' : '人机对战';
  const modes = [
    ['ai', '⚔', '人机对战', '你执玩家 A，电脑执玩家 B', '先熟悉规则与节奏'],
    ['demo', '👁', '自动观战', '双方都由电脑操控，上帝视角', '看它怎么打，学套路'],
    ['online', '🌐', '联机对战', '开房间拿邀请码，朋友输码进局', '两台设备，真人对战'],
  ];
  overlay(`<div class="menu">
    <div class="mhero">
      <div class="mcrest">♛</div>
      <h1 class="mtitle">王权窃贼</h1>
      <div class="msub">ROYAL THIEF</div>
      <div class="mtag">双人回合制卡牌博弈 · 28 张牌 · 同时暗置宣告 · 身份克制</div>
      <div class="mstats"><span>人 12</span><span>武器 6</span><span>皇冠 2</span><span>隐身衣 1</span><span>功能 7</span></div>
    </div>
    <div class="mdivider"><span>选择对局方式</span></div>
    <div class="mmodes">
      ${modes.map(([k, ic, t, d, n]) => `<button class="mbtn${ui.mode === k ? ' on' : ''}" data-act="menu-mode" data-mode="${k}">
        <span class="mico">${ic}</span>
        <span class="mtxt"><b>${t}</b><small>${d}</small></span>
        <span class="mnote">${n}</span>
      </button>`).join('')}
    </div>
    <div class="btnrow">
      <button class="act big" data-act="menu-start">开始对局 · ${cur}</button>
      <button class="act secondary" data-act="menu-rules">规则速览</button>
    </div>
    <div class="monlinewrap">${onlinePanelHtml()}</div>
    <div class="mfoot">
      <span>手机上玩：<a class="mlink" href="/web/mobile.html">打开手游版 →</a></span>
      <span>零依赖单文件：<code>dist/王权窃贼.html</code></span>
    </div>
  </div>`);
}
function showRules() {
  overlay(`<h2>规则速览</h2>
    <div class="rules-doc">
      <h3>牌组（28 张）</h3>
      <ul><li>人（善）×6、人（恶）×6：唯一能出战的牌</li>
      <li>武器 ×6、皇冠 ×2、隐身衣 ×1：道具，每名玩家最多持有 1 张皇冠</li>
      <li>功能牌 ×7（每种全局仅 1 张）：洞若观火、重整、颠倒是非、铸剑为犁、推心置腹、沉默、止戈</li></ul>
      <h3>回合</h3>
      <ul><li>抽牌 → 能力牌（<b>双方同时暗置</b>，各出最多 1 张，都提交后依次结算）→ 背水一战 → 双方同时暗置宣告 → 战斗结算 → 回合结束</li>
      <li>能力牌阶段两边各有一次出牌机会：轮到你时桌面会弹出「请打出一张能力牌」，出完或跳过就等对手提交</li>
      <li>手牌恰好 1 张人牌时出战 → 临时变身为骑士（善）／匪徒（恶），仅自己可见</li>
      <li>不出战 → 对手随机夺走你 1 张手牌（功能牌不可被夺）</li></ul>
      <h3>身份与克制</h3>
      <ul><li>单人＝普通人；人＋武器＝骑士／匪徒（按善恶）；人＋皇冠＝国王；人＋隐身衣＝贼</li>
      <li>骑士克匪徒、普通人；匪徒克国王、普通人；国王克骑士；普通人克国王；贼无克制（必平局）</li>
      <li>平局：双方出战卡牌全部进弃牌堆（不返还手牌），所以平局是实打实的掉牌</li></ul>
      <h3>终局</h3>
      <ul><li>手牌归零立刻判负（出战牌离手期间不判）</li>
      <li>主牌堆已空时打出止戈 → 立刻停战、比手牌数（手牌多者胜）；牌堆空后连续 3 回合无胜负 → 比手牌数；40 回合上限 → 比手牌数</li></ul>
      <h3>界面</h3>
      <ul><li>中间是判定区，右侧是战报流程，手牌右上角是「出战 / 不出战 / 跳过 / 确认」按钮</li>
      <li>悬停卡牌放大看说明；轮到你要操作时桌面会弹提示（弹出即走，不挡视线）</li>
      <li>对手手牌数量默认隐藏，显示「数量未知」</li></ul>
      <h3>信息</h3>
      <ul><li>对手手牌数量默认隐藏；功能牌结算只提示「结算完成」</li>
      <li>悬停任意卡牌可放大并查看说明</li>
      <li>完整规则见 <code>docs/王权窃贼-规则-v2.md</code></li></ul>
    </div>
    <div class="btnrow" style="margin-top:14px">
      <button class="act" data-act="close-rules">关闭</button>
      <button class="act secondary" data-act="menu">返回主界面</button>
    </div>`);
}
/* ---------------- 交互事件 ---------------- */
const hitTarget = (ev) => ((ev.target && typeof ev.target.closest === 'function')
  ? (ev.target.closest('[data-play],[data-give],[data-person],[data-item],[data-act]') || ev.target)
  : ev.target);

$('overlay').addEventListener('click', (ev) => {
  const d = hitTarget(ev).dataset ?? {};
  const act = d.act;
  if (!act) return;
  if (act === 'ready') { ui.lastActor = ui.gate; ui.gate = null; hideOverlay(); render(); }
  if (act === 'again') { newGame(); }
  if (act === 'close') { hideOverlay(); }
  if (act === 'close-rules') { hideOverlay(); }
  if (act === 'menu') { showMenu(); }
  if (act === 'menu-rules') { showRules(); }
  if (act === 'menu-start') { newGame(); }
  if (act === 'menu-mode') {
    if (d.mode === 'online') {
      // 联机不是本地模式：把下面的开房面板点亮并聚焦输入框
      const w = ev.target?.closest?.('.menu')?.querySelector?.('.monlinewrap');
      w?.classList?.add?.('hot');
      w?.querySelector?.('input')?.focus?.();
      return;
    }
    if (d.mode) ui.mode = d.mode;
    showMenu();
  }
  if (act === 'online-create') { onlineCreate(); }
  if (act === 'online-join') {
    const box = ev.target?.closest?.('.monline');
    const code = String(box?.querySelector?.('input.molcode')?.value ?? '').trim().toUpperCase();
    onlineJoin(code);
  }
  if (act === 'online-save-server') {
    const box = ev.target?.closest?.('.monline');
    const raw = String(box?.querySelector?.('input.molserver')?.value ?? '').trim();
    saveServerOrigin(raw);
    ui.lobbyErr = '';
    toast(normalizeServer(raw) ? '联机服务器已保存：' + normalizeServer(raw) : '已改为「同源」，用当前网页所在的服务器联机');
    newGame();
    showMenu();
  }
  if (act === 'online-copy') { copyInviteLink(); }
  if (act === 'online-rematch') { onlineRematch(); }
  if (act === 'online-leave') { onlineLeave(); }
});

$('prompt').addEventListener('click', (ev) => {
  const d = hitTarget(ev).dataset ?? {};
  const actor = ui.s.actor();
  if (d.play) {
    const c = ui.s.view(actor).yourHand.find((x) => x.id === d.play);
    if (c && c.label === '推心置腹') { ui.sel.giveFor = d.play; render(); return; }
    step(() => ui.s.act(actor, { type: 'PLAY_FUNCTION', cardId: d.play }));
    return;
  }
  if (d.give) { step(() => ui.s.act(actor, { type: 'PLAY_FUNCTION', cardId: ui.sel.giveFor, giveCardId: d.give })); ui.sel = {}; return; }
  if (d.person) { ui.sel.personId = ui.sel.personId === d.person ? null : d.person; render(); return; }
  if (d.item) { ui.sel.itemId = ui.sel.itemId === d.item ? null : d.item; render(); return; }
  if (d.act === 'cancel-give') { ui.sel = {}; render(); return; }
  if (d.act === 'pass') { step(() => ui.s.act(actor, { type: 'PASS_FUNCTION' })); return; }
  if (d.act === 'fight') {
    if (!ui.sel.personId) { toast('先在手里点亮一张人牌'); return; }
    const cmd = { type: 'DECLARE', playerId: actor, fight: true, personCardId: ui.sel.personId };
    if (ui.sel.itemId) cmd.itemCardId = ui.sel.itemId;
    ui.sel = {};
    step(() => ui.s.act(actor, cmd));
    return;
  }
  if (d.act === 'pass-declare') { ui.sel = {}; step(() => ui.s.act(actor, { type: 'DECLARE', playerId: actor, fight: false })); return; }
  if (d.act === 'reward-ok') {
    const pick = ui.sel.reward;
    if (pick !== 'keep' && pick !== 'take') return;
    ui.sel = {};
    step(() => ui.s.act(actor, { type: 'CHOOSE_REWARD', playerId: actor, option: pick }));
    return;
  }
  if (d.act === 'reward-reset') { ui.sel.reward = null; render(); return; }
});

document.querySelector('.board').addEventListener('click', (ev) => {
  // 战利品：点牌桌上「你想留下的那张」= 选中（确认在提示里）
  const pick = ev.target.closest?.('[data-reward]')?.dataset?.reward;
  if (pick === 'keep' || pick === 'take') {
    hideZoom();
    if (!rewardPick()) return;
    ui.sel.reward = ui.sel.reward === pick ? null : pick;
    render();
    return;
  }
  const act = ev.target.closest?.('[data-act]')?.dataset?.act;
  if (act === 'peek-view') {
    hideZoom();
    const seen = (ui.s?.view(currentViewer()).yourSeenThisTurn ?? []).map((c) => c.id);
    if (seen.length) showPeek(seen, '本回合你窥探到的牌');
    return;
  }
  const id = ev.target.closest?.('.card')?.dataset?.card;
  hideZoom();
  if (!id || !ui.s || ui.s.state.winner) return;
  const actor = ui.s.actor();
  // 判定「这张手牌是不是我能点的」：只看本机看到的是谁（联机坐 B 时也要能点自己的牌）
  if (!actor || ui.s.isBot(actor)) return;
  if (currentViewer() !== actor) return;
  const st = ui.s.state;
  const c = st.cards[id];
  const p = st.pending;
  if (p?.kind === 'function-phase') {
    if (ui.sel.giveFor) {
      // 正在为推心置腹挑牌：点自己手牌里任意一张非功能牌即完成交换
      if (c.kind === 'function' || c.id === ui.sel.giveFor) return;
      const give = ui.sel.giveFor;
      step(() => ui.s.act(actor, { type: 'PLAY_FUNCTION', cardId: give, giveCardId: c.id }));
      ui.sel = {};
      return;
    }
    if (c.kind !== 'function' || p.submitted.includes(actor)) return;
    if (c.name === '推心置腹') { ui.sel.giveFor = id; render(); return; }
    step(() => ui.s.act(actor, { type: 'PLAY_FUNCTION', cardId: id }));
    return;
  }
  if (p?.kind === 'declare-phase') {
    if (p.submitted.includes(actor)) return;
    if (c.kind === 'person') { ui.sel.personId = ui.sel.personId === id ? null : id; render(); return; }
    if (c.kind === 'item') { ui.sel.itemId = ui.sel.itemId === id ? null : id; render(); return; }
  }
});

/* 战斗判定播放中：点牌桌中央快进到最终结果 */
$('arena').addEventListener('click', () => {
  if (!battleBusy()) return;
  clearTimeout(ui.battle.timer);
  ui.battle.timer = null;
  ui.battle.t = ui.battle.steps.length - 1;
  finishBattle();
});

const boardEl = document.querySelector('.board');
boardEl.addEventListener('mouseover', (ev) => {
  const t = ev.target;
  const card = t && typeof t.closest === 'function' ? t.closest('[data-card],[data-secret]') : null;
  if (card) showZoom(card);
});
boardEl.addEventListener('mouseout', (ev) => {
  const t = ev.target;
  const card = t && typeof t.closest === 'function' ? t.closest('[data-card],[data-secret]') : null;
  if (!card) return;
  const to = ev.relatedTarget;
  if (to && typeof card.contains === 'function' && card.contains(to)) return;
  hideZoom();
});
if (typeof globalThis.addEventListener === 'function') globalThis.addEventListener('resize', hideZoom);

$('modeSeg').addEventListener('click', (ev) => {
  const mode = ev.target.dataset?.mode;
  if (!mode) return;
  ui.mode = mode;
  syncModeSeg();
  newGame();
});
$('btnMenu').addEventListener('click', showMenu);
$('btnNew').addEventListener('click', () => newGame());
$('btnRules').addEventListener('click', showRules);
if ($('btnInvite')) $('btnInvite').addEventListener('click', copyInviteLink);
$('btnLog').addEventListener('click', () => { $('logPanel').classList.toggle('hidden'); renderLog(); });
$('btnLogClose').addEventListener('click', () => $('logPanel').classList.add('hidden'));
$('btnRailRules').addEventListener('click', showRules);
$('chkCount').addEventListener('change', (ev) => { RULES.revealHandCounts = ev.target.checked; render(); });
$('chkDeck').addEventListener('change', (ev) => { RULES.revealDeckCount = ev.target.checked; renderPiles(ui.s.state); });
$('tabs').addEventListener('click', (ev) => {
  const tab = ev.target.dataset?.log;
  if (!tab) return;
  ui.logTab = tab;
  for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.log === tab);
  renderLog();
});

/* ---------------- 联机房间 ----------------
   两条通路，界面完全一样：
     http  自建后端（server.mjs）：服务器权威 + SSE 推送，适合公网长期开着的后端
     relay 公共中继（web/relay.js）：房主浏览器就是服务器，静态网页也能直接开双人局 */
function onlineTransport() {
  if (ui.relayWanted) return 'relay';
  return serverOrigin() ? 'http' : 'relay';
}
function onlineAvailable() {
  if (serverOrigin()) return true;
  if (ui.relayWanted) return true;
  if (typeof location !== 'undefined' && location.protocol === 'file:') {
    // 单文件版没有服务器：先本地跑起来，联机时再按需去拿中继库
    return typeof document !== 'undefined';
  }
  return true;
}
function roomLink(code) {
  if (!code) return '';
  // file:// 打开的本地文件没有可分享的网址，只能口头报邀请码
  if (typeof location === 'undefined' || !location.origin || location.protocol === 'file:') return code;
  const origin = serverOrigin();
  // 邀请链接自带连接方式：朋友点开就能连上同一台后端 / 同一个中继，不用自己配
  if (!origin && !ui.relayWanted) ui.relayWanted = true;
  const tail = origin ? `&server=${encodeURIComponent(origin)}` : '&relay=1';
  return `${location.origin}${location.pathname}?room=${code}${tail}`;
}
// 把「邀请码 + 后端地址」拼成一条能直接发人的链接（静态托管时后端地址必须带上）
function copyInviteLink() {
  const code = ui.room?.code ?? '';
  if (!code) { toast('还没开房间，先去主界面点「创建房间」'); return; }
  const link = roomLink(code);
  try { navigator.clipboard?.writeText(link); toast('邀请链接已复制：' + link); } catch { toast(link); }
}

function onlinePanelHtml() {
  if (!onlineAvailable()) {
    return '<div class="monline"><div class="molhead">联机对战</div>'
      + '<div class="molhint">这个环境拿不到联机中继，请把网页放到 http(s) 上再开房。</div></div>';
  }
  if (ui.room?.code) {
    const both = Boolean(ui.room.seats?.A && ui.room.seats?.B);
    return '<div class="monline on">'
      + `<div class="molhead">房间 <b>${ui.room.code}</b> · 你坐${ui.seat === 'A' ? '玩家 A' : '玩家 B'}</div>`
      + `<div class="mollink">${roomLink(ui.room.code)}</div>`
      + '<div class="btnrow">'
      + '<button class="act" data-act="online-copy">复制邀请链接</button>'
      + '<button class="act secondary" data-act="online-rematch">再来一局</button>'
      + '<button class="act secondary" data-act="online-leave">退出房间</button>'
      + '</div>'
      + `<div class="molhint">${both ? '双方都到齐了，开打！' : `等待对手（玩家 ${other(ui.seat)}）按邀请码进来…`}</div>`
      + '</div>';
  }
  return '<div class="monline">'
    + '<div class="molhead">联机对战 · 创建房间 / 输入邀请码</div>'
    + '<div class="molrow">'
    + '<button class="act" data-act="online-create">创建房间</button>'
    + '<span class="molsplit">或</span>'
    + '<input class="molinput molcode" maxlength="4" placeholder="邀请码" autocomplete="off" />'
    + '<button class="act secondary" data-act="online-join">加入房间</button>'
    + '</div>'
    + `<div class="molhint">${ui.lobbyErr ? `<b class="molerr">${ui.lobbyErr}</b>` : '创建后得到 4 位邀请码和一条链接，发给朋友就能开局'}</div>`
    + '<div class="molrow molserverrow">'
    + `<input class="molinput molserver" placeholder="联机服务器（留空 = 免服务器直连）" autocomplete="off" value="${serverOrigin()}" />`
    + '<button class="act secondary" data-act="online-save-server">保存</button>'
    + '</div>'
    + '</div>';
}

async function onlineCreate() {
  ui.lobbyErr = '';
  if (onlineTransport() === 'relay') { startOnline({ relay: true, seat: 'A' }); return; }
  try {
    const r = await fetch(apiUrl('/api/room/create'), { method: 'POST' });
    const j = await r.json();
    if (!j.code) throw new Error(j.error ?? '创建失败');
    startOnline({ code: j.code, token: j.token, seat: j.seat });
  } catch (err) {
    ui.lobbyErr = '创建房间失败：' + err.message + (serverOrigin() ? '' : '（没有配置联机服务器，静态托管的网页需要先填后端地址）');
    if (ui.mode === 'online') newGame(); else showMenu();
  }
}

const roomTokenKey = (code) => 'rt-room-' + code;

// 本标签页自己的凭证：刷新页面能回到原座位，但新开一个标签页不会把对手的座位抢走
function saveRoomToken(code, seat, token) {
  try { sessionStorage.setItem(roomTokenKey(code), token); } catch { /* 隐私模式忽略 */ }
  try {
    const all = JSON.parse(localStorage.getItem('rt-rooms') ?? '{}');
    all[code] = { ...(all[code] ?? {}), [seat]: token };
    localStorage.setItem('rt-rooms', JSON.stringify(all));
  } catch { /* 隐私模式忽略 */ }
}
function savedRoomTokens(code) {
  const out = [];
  try { const t = sessionStorage.getItem(roomTokenKey(code)); if (t) out.push(t); } catch { /* 忽略 */ }
  try {
    const all = JSON.parse(localStorage.getItem('rt-rooms') ?? '{}');
    for (const t of Object.values(all[code] ?? {})) if (t && !out.includes(t)) out.push(t);
  } catch { /* 忽略 */ }
  return out;
}

async function onlineJoin(code) {
  ui.lobbyErr = '';
  if (!code) { ui.lobbyErr = '请先输入 4 位邀请码'; newGame(); showMenu(); return; }
  if (onlineTransport() === 'relay') { startOnline({ relay: true, seat: 'B', code }); return; }
  // 刷新页面后凭旧令牌回到原座位，而不是把房间占成对手
  let saved = null;
  try { saved = sessionStorage.getItem('rt-room-' + code); } catch { /* 隐私模式忽略 */ }
  if (saved) {
    try {
      const r = await fetch(apiUrl(`/api/room/state?code=${encodeURIComponent(code)}&token=${saved}`));
      if (r.ok) { const j = await r.json(); startOnline({ code, token: saved, seat: j.you }); return; }
    } catch { /* 服务器不可达时继续走正常加入 */ }
  }
  try {
    const r = await fetch(apiUrl('/api/room/join'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
    });
    const j = await r.json();
    if (!j.code) {
      // 满员了：可能是本机刷新 / 浏览器崩了重开，用 localStorage 里的旧凭证把座位抢回来
      for (const t of savedRoomTokens(code)) {
        if (t === saved) continue;
        const r2 = await fetch(apiUrl(`/api/room/state?code=${encodeURIComponent(code)}&token=${t}`));
        if (r2.ok) { const j2 = await r2.json(); startOnline({ code, token: t, seat: j2.you }); return; }
      }
      throw new Error(j.error === 'room-full' ? '这个房间已经满员了'
        : j.error === 'room-not-found' ? '没有这个邀请码，检查一下字母数字' : (j.error ?? '加入失败'));
    }
    startOnline({ code: j.code, token: j.token, seat: j.seat });
  } catch (err) {
    ui.lobbyErr = '加入失败：' + err.message + (serverOrigin() ? '' : '（没有配置联机服务器，静态托管的网页需要先填后端地址）');
    newGame(); showMenu();
  }
}

function startOnline(info) {
  if (ui.s?.close) ui.s.close();
  ui.mode = 'online';
  const hooks = { onSnapshot: applyOnlineSnapshot, onStatus: onlineStatus };
  let s;
  if (info.relay) {
    ui.relayWanted = true;
    s = info.seat === 'A'
      ? createRelayHostSession(hooks)
      : createRelayGuestSession({ code: info.code, ...hooks });
  } else {
    s = createRemoteSession({ code: info.code, token: info.token, seat: info.seat, ...hooks });
  }
  ui.seat = s.seat;
  ui.room = { code: s.code, token: s.token, seat: s.seat, relay: Boolean(s.relay), seats: { A: false, B: false } };
  saveRoomToken(s.code, s.seat, s.token ?? 'relay');
  ui.s = s;
  ui.s.connect();
  newGame();
  syncModeSeg();
  toast(s.seat === 'A'
    ? '房间 ' + s.code + ' 开好了 · 点顶栏「邀请」复制链接，发给朋友就能开局'
    : '已进入房间 ' + s.code + ' · 等房主出牌');
}

function onlineLeave() {
  if (ui.s?.close) ui.s.close();
  ui.mode = 'ai';
  ui.seat = null;
  ui.room = null;
  ui.lobbyErr = '';
  newGame();
  showMenu();
}

let rematchArmed = 0;
async function onlineRematch() {
  if (!ui.s?.rematch) return;
  // 不用原生 confirm：它会卡住整个页面线程，而且手机上也难看
  const now = Date.now();
  if (now - rematchArmed > 4000) {
    rematchArmed = now;
    toast('再点一次「再来一局」就重开（对手也会一起重开）');
    return;
  }
  rematchArmed = 0;
  const ok = await ui.s.rematch();
  if (!ok) toast('重开失败，可能连接断了');
}

function applyOnlineSnapshot(snap, src = 'sse') {
  if (!ui.s || ui.mode !== 'online' || !snap?.state) return;
  // 两条送达路径（SSE 推送 / 出手后补拉的 GET）会赛跑：旧快照后到就会把新状态盖回去，
  // 牌桌就会卡在上一阶段等人。所以按 seq 判新旧，新局（gameId 变了）不适用。
  const sameGame = snap.gameId === ui.s.gameId;
  if (sameGame && typeof snap.seq === 'number' && snap.seq < (ui.s.state?.seq ?? 0)) return;
  if (ui.s.trace) {
    ui.s.trace.push({ src: 'apply:' + src, seq: snap.seq, prevSeq: ui.s.state?.seq ?? null, kind: snap.state.pending?.kind ?? '-' });
    if (ui.s.trace.length > 80) ui.s.trace.shift();
  }
  const fresh = snap.gameId !== ui.s.gameId;
  const prevSeats = ui.room?.seats ?? { A: false, B: false };
  if (fresh) {
    resetLocalUi();
    ui.s.gameId = snap.gameId;
    // 刚开的局（事件不多）从头播一遍发牌动画；中途加入的直接跳到当前
    ui.seq = snap.events.length > 12 ? snap.seq : 0;
    hideOverlay();
  }
  ui.seat = snap.you;
  ui.room = { ...(ui.room ?? {}), code: snap.code, seats: snap.seats };
  if (!prevSeats[other(ui.seat)] && snap.seats[other(ui.seat)]) queueBanner('对手已进入房间', '双方同时暗置宣告，准备好了就出战', 'turn');
  ui.s.state = snap.state;
  ui.s.viewCache = snap.view;
  ui.s.queue = snap.events;
  ui.s.ready = true;
  captureNewEvents();
  render();
}

function onlineStatus(kind, extra) {
  if (kind === 'online') return;
  if (kind === 'reconnecting') { toast('和服务器断开了，正在重连…'); return; }
  if (kind === 'rejected') {
    toast(extra === 'not-your-turn' ? '还没轮到你操作' : extra === 'bad-token' ? '房间凭证失效了，请重新加入' : '服务器没接受这次操作');
    return;
  }
  if (kind === 'offline') {
    toast(serverOrigin()
      ? `连不上联机服务器（${serverOrigin()}）：确认后端已部署、地址没写错`
      : '连不上联机中继：检查网络后重试；也可以在主界面填自建后端地址');
  }
  if (kind === 'waiting-host') toast('还没找到房主：确认邀请码没写错，并且对方页面还开着');
  if (kind === 'no-sse') toast('这个浏览器不支持联机推送（EventSource）');
}
/* ---------------- 启动 ---------------- */
$('chkCount').checked = Boolean(RULES.revealHandCounts);
$('chkDeck').checked = Boolean(RULES.revealDeckCount);

try {
  // 先把牌桌渲染出来（单文件版与测试都依赖这一步），再盖上主界面
  const rtParams = typeof location !== 'undefined' && location.search ? new URLSearchParams(location.search) : null;
  const rtRoom = (rtParams?.get('room') ?? rtParams?.get('code') ?? '').trim().toUpperCase();
  ui.relayWanted = (rtParams?.get('relay') ?? '') === '1';
  if (rtRoom) { newGame(); showMenu(); onlineJoin(rtRoom); } else { newGame(); showMenu(); }
} catch (err) {
  fatal(`初始化失败：${err.message}`, String(err.stack ?? ''));
}
export function setBotDelay(ms) { ui.botDelay = ms; }
export function startGame(seed, mode) { if (mode) ui.mode = mode; newGame(seed); }
export function getUiSnapshot() { return { mode: ui.mode, gate: ui.gate, battle: ui.battle }; }

// 测试用：联机快照的送达 / 应用轨迹
export function __onlineTrace() { return ui.s?.trace ?? null; }

// 测试用：把「战斗判定逐条回放」的 HTML 直接渲染出来（不碰 DOM、不等动画），
// 用来锁住贼效果 / 平局 / 战利品去向这些随机很难撞到的分支。
export function __battleHtmlForTest(story, t = 99) {
  const steps = battleSteps(story);
  const i = Math.max(0, Math.min(t, steps.length - 1));
  const reached = (k) => steps.includes(k) && i >= steps.indexOf(k);
  return {
    steps,
    html: `<div class="btl">${battleLines(story, steps, i)}</div>`,
    sideA: story.reveal ? revealSide(story.reveal.A, 'A', story, reached) : '',
  };
}