// 免后端联机：两名玩家通过公共 MQTT 中继互相转发消息，房主浏览器里跑权威引擎。
//
// 为什么要有它：静态托管的网页（Cloudflare Pages / CodeSandbox / 直接发 HTML）没有后端，
// 单机能玩，双人就开不了局。这里补上：
//   · 房主建房：房主浏览器里跑 src/room.js 里那套一模一样的房间内核（发牌、脱敏、判负都在同一份代码里），
//     只把「各自脱敏」的快照分别发出去，所以对手的手牌、牌堆、背水一战一样看不到。
//   · 客机加入：把自己的指令发到 up 主题，等房主把属于自己座位的快照推回来。
//   · 中继用公开 MQTT broker（EMQX / Mosquitto 公共测试服），不用注册、不用自己开服务器。
//
// 主题（royal-thief/v1/<邀请码>/…）：
//   up    客机 → 房主：{t:'join'} / {t:'act',cmd} / {t:'rematch'} / {t:'ping'}
//   a     房主 → 座位 A：脱敏快照
//   b     房主 → 座位 B：脱敏快照
//   ctrl  房主 → 客机：{t:'joined',seat} / {t:'full'} / {t:'rejected',error} / {t:'pong'}
//
// 安全边界：邀请码就是房间钥匙——知道邀请码的人能拿到「自己那份」快照、能提交自己的指令。
// 朋友之间开局够用；要更严格的身份校验就用自建后端（server.mjs + 界面里填服务器地址）。
import { createHub } from '../src/room.js';

const NS = 'royal-thief/v1';

// 公共中继，按顺序尝试：前面连不上就换下一个
export const RELAY_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

const mirrorOf = (id) => (id === 'A' ? 'B' : 'A');

// 还没拿到第一帧快照时先渲染这个空壳，结构跟真状态一模一样
const emptyState = () => ({
  cards: {}, deck: [], discard: [],
  players: { A: { hand: [], silenced: false }, B: { hand: [], silenced: false } },
  turn: 'A', round: 1, phase: 'draw', atWarCounter: 0, berserk: { A: false, B: false },
  pending: null, winner: null, events: [], seq: 0,
});

// 中继客户端按需加载：单机完全不碰它，只有联机时才拉 mqtt.js（先本地再 CDN）
let mqttLoading = null;
export function loadRelayLib() {
  if (globalThis.mqtt?.connect) return Promise.resolve(globalThis.mqtt);
  if (mqttLoading) return mqttLoading;
  mqttLoading = new Promise((resolve, reject) => {
    if (typeof document === 'undefined') { reject(new Error('no-dom')); return; }
    const srcs = ['vendor/mqtt.min.js', 'https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js'];
    const next = (i) => {
      if (i >= srcs.length) { reject(new Error('中继库加载失败')); return; }
      const tag = document.createElement('script');
      tag.src = srcs[i];
      tag.onload = () => (globalThis.mqtt?.connect ? resolve(globalThis.mqtt) : next(i + 1));
      tag.onerror = () => { tag.remove(); next(i + 1); };
      document.head.appendChild(tag);
    };
    next(0);
  });
  return mqttLoading;
}

// 接上中继：返回 { send(频道, 对象), close() }
export async function openRelay({ code, role, onMessage, onStatus }) {
  const mqtt = await loadRelayLib();
  const base = NS + '/' + String(code ?? '').toUpperCase();
  const subs = role === 'host' ? [base + '/up'] : [base + '/b', base + '/ctrl'];
  let lastErr = null;
  for (const url of RELAY_BROKERS) {
    try {
      const client = await new Promise((resolve, reject) => {
        const c = mqtt.connect(url, {
          clientId: 'rt-' + Math.random().toString(16).slice(2, 12),
          connectTimeout: 9000,
          reconnectPeriod: 3000,
          clean: true,
        });
        const fail = (err) => { try { c.end(true); } catch { /* 忽略 */ } reject(err ?? new Error('connect-failed')); };
        const timer = setTimeout(() => fail(new Error('connect-timeout')), 12000);
        c.once('connect', () => { clearTimeout(timer); resolve(c); });
        c.once('error', (err) => { clearTimeout(timer); fail(err); });
      });
      await new Promise((res, rej) => client.subscribe(subs, { qos: 0 }, (err) => (err ? rej(err) : res())));
      client.on('message', (topic, payload) => {
        let msg = null;
        try { msg = JSON.parse(payload.toString()); } catch { return; }
        onMessage?.(topic, msg);
      });
      client.on('close', () => onStatus?.('reconnecting'));
      return {
        url,
        send(channel, obj) { client.publish(base + '/' + channel, JSON.stringify(obj), { qos: 0 }); },
        close() { try { client.end(true); } catch { /* 忽略 */ } },
      };
    } catch (err) { lastErr = err; }
  }
  throw lastErr ?? new Error('relay-unreachable');
}

function baseSession({ code, seat, token = '' }) {
  return {
    mode: 'online', relay: true, code, token, seat, seed: code,
    gameId: null, ready: false, status: 'connecting', link: null, joinTimer: null, closed: false,
    state: emptyState(), viewCache: null, queue: [], trace: [], lastAt: 0, onSnapshot: null,

    note(src, snap) {
      this.lastAt = Date.now();
      this.trace.push({ src, seq: snap?.seq ?? null, kind: snap?.state?.pending?.kind ?? '-', w: snap?.state?.winner ?? null });
      if (this.trace.length > 80) this.trace.shift();
    },
    apply(snap, src) {
      if (!snap?.state) return;
      if (this.joinTimer) { clearInterval(this.joinTimer); this.joinTimer = null; }
      this.note(src, snap);
      this.seat = snap.you ?? this.seat;
      // 先把快照交给界面：它要靠「旧 state 的 seq」判新旧、靠 gameId 判是不是新开的一局，
      // 所以 state / viewCache / queue / gameId 都必须等它读完再覆盖（和 remote.js 的时序一致）。
      this.onSnapshot?.(snap, 'relay');
      this.gameId = snap.gameId ?? this.gameId;
      this.viewCache = snap.view;
      this.queue = snap.events ?? [];
      this.state = snap.state;
      this.ready = true;
    },
    isBot() { return false; },
    view() { return this.viewCache; },
    botCommand() { return null; },
    eventsSince(seq) { return this.queue.filter((e) => e.seq > seq); },
    actor() {
      const st = this.state;
      if (!st || st.winner || !st.pending) return null;
      return this.seat;
    },
    waitingFor() {
      const p = this.state?.pending;
      if (p?.kind !== 'declare-phase' && p?.kind !== 'function-phase') return null;
      return p.submitted.includes(this.seat) ? mirrorOf(this.seat) : this.seat;
    },
  };
}

// 房主：本地跑权威引擎，把两边各自的脱敏快照分别推出去
export function createRelayHostSession({ onSnapshot, onStatus, openLink } = {}) {
  const hub = createHub();
  const me = hub.create();
  const S = baseSession({ code: me.code, seat: 'A', token: me.token });
  S.onSnapshot = onSnapshot;
  const room = hub.auth(me.code, me.token).room;

  // A 的快照留在本地渲染；B 的快照原样转发到 b 主题（脱敏在 hub 里已经做过了）
  hub.on(me.code, 'A', (snap) => S.apply(snap, 'relay'));
  hub.on(me.code, 'B', (snap) => S.link?.send('b', snap));

  const publish = () => hub.publish(room);

  const onUp = (_topic, msg) => {
    if (S.closed || !msg || typeof msg !== 'object') return;
    if (msg.t === 'join') {
      const out = hub.join(me.code);
      if (out.error) { S.link?.send('ctrl', { t: 'full' }); return; }
      S.link?.send('ctrl', { t: 'joined', seat: out.seat, code: me.code });
      S.link?.send('b', hub.snapshot(room, out.seat));
      publish();
      return;
    }
    if (msg.t === 'act') {
      const out = hub.act(room, 'B', msg.cmd);
      if (out.error) S.link?.send('ctrl', { t: 'rejected', error: out.error });
      else publish();
      return;
    }
    if (msg.t === 'rematch') { S.rematch(); return; }
    if (msg.t === 'ping') { S.link?.send('ctrl', { t: 'pong' }); }
  };

  S.act = function (_playerId, cmd) {
    const out = hub.act(room, 'A', cmd);
    if (out.error) onStatus?.('rejected', out.error);
    else publish();
  };
  S.rematch = function () { hub.rematch(room); publish(); return true; };

  S.connect = function () {
    publish(); // 先让自己这张牌桌亮起来，客人什么时候来都不影响
    (openLink ?? openRelay)({ code: me.code, role: 'host', onMessage: onUp, onStatus })
      .then((link) => { S.link = link; S.status = 'online'; onStatus?.('online'); publish(); })
      .catch(() => { S.status = 'offline'; onStatus?.('offline'); });
  };
  S.close = function () { S.closed = true; if (S.link) { S.link.close(); S.link = null; } };
  return S;
}

// 客机：自己不算牌，只把指令发上去、把属于自己座位的快照渲染出来
export function createRelayGuestSession({ code, onSnapshot, onStatus, openLink } = {}) {
  const S = baseSession({ code: String(code ?? '').toUpperCase(), seat: 'B' });
  S.onSnapshot = onSnapshot;

  const onDown = (topic, msg) => {
    if (S.closed) return;
    if (String(topic).endsWith('/ctrl')) {
      if (msg.t === 'full') onStatus?.('rejected', 'room-full');
      else if (msg.t === 'joined') { S.seat = msg.seat ?? S.seat; S.status = 'online'; onStatus?.('online'); }
      else if (msg.t === 'rejected') onStatus?.('rejected', msg.error);
      return;
    }
    S.apply(msg, 'relay');
  };

  const say = (obj) => S.link?.send('up', obj);

  S.act = function (_playerId, cmd) { say({ t: 'act', cmd }); };
  S.rematch = function () { say({ t: 'rematch' }); return true; };

  S.connect = function () {
    (openLink ?? openRelay)({ code: S.code, role: 'guest', onMessage: onDown, onStatus })
      .then((link) => {
        S.link = link;
        S.status = 'online';
        onStatus?.('online');
        say({ t: 'join' });
        // 房主可能刚开房还没接上中继，隔几秒补喊一次，直到拿到第一帧
        S.joinTimer = setInterval(() => { if (!S.ready) say({ t: 'join' }); }, 2500);
        setTimeout(() => { if (!S.ready) onStatus?.('waiting-host'); }, 9000);
      })
      .catch(() => { S.status = 'offline'; onStatus?.('offline'); });
  };
  S.close = function () {
    S.closed = true;
    if (S.joinTimer) { clearInterval(S.joinTimer); S.joinTimer = null; }
    if (S.link) { S.link.close(); S.link = null; }
  };
  return S;
}
