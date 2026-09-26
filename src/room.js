// 房间服务（联机对战）：只有服务器持有完整 state，客户端各拿自己那份 redact + view。
//
// 传输层不在这里：本模块只做「房间/座位/令牌/指令校验/快照」，
// HTTP + SSE 的接线在 server.mjs，浏览器端的会话适配在 web/remote.js。
// 浏览器里房主也要跑同一份房间逻辑（免后端联机），所以不依赖 node:crypto：
// Node >= 19 和所有现代浏览器都有 globalThis.crypto（Web Crypto）。
const webCrypto = globalThis.crypto;
const randomUUID = () => webCrypto.randomUUID();
const randomToken = () => Array.from(webCrypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
import { createGame, apply } from './engine.js';
import { viewFor } from './view.js';
import { redactState, visibleEventsFor, stripSeed } from './redact.js';

// 去掉容易看错的 I O 0 1，邀请码只念不写错
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 4;
const IDLE_MS = 6 * 60 * 60 * 1000; // 6 小时没人动就回收

const roomMirror = (id) => (id === 'A' ? 'B' : 'A');

function makeCode() {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

// 该座位此刻是否被允许提交指令（apply() 不校验身份，必须在这里挡住）
export function canAct(state, seat) {
  const p = state.pending;
  if (!p || state.winner) return false;
  if (p.kind === 'function-phase') return !p.submitted.includes(seat);
  if (p.kind === 'declare-phase') return !p.submitted.includes(seat);
  if (p.kind === 'battle-reward') return p.winner === seat;
  return false;
}

export function createHub() {
  const rooms = new Map();

  const sweep = () => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (now - room.touched > IDLE_MS && room.listeners.A.size === 0 && room.listeners.B.size === 0) rooms.delete(code);
    }
  };

  const newGame = (seed) => createGame(seed ?? Math.floor(Math.random() * 900000000) + 1000000);

  const findRoom = (code) => rooms.get(String(code ?? '').toUpperCase().trim()) ?? null;

  function open(code, seat) {
    const room = findRoom(code);
    if (!room) return null;
    const token = randomToken();
    room.seats[seat] = { token, joinedAt: Date.now() };
    room.touched = Date.now();
    return { code: room.code, seat, token };
  }

  return {
    create() {
      sweep();
      let code = makeCode();
      while (rooms.has(code)) code = makeCode();
      const state = newGame();
      const room = {
        code,
        gameId: randomUUID(),
        state,
        seats: { A: null, B: null },
        listeners: { A: new Set(), B: new Set() },
        touched: Date.now(),
      };
      rooms.set(code, room);
      return open(code, 'A');
    },

    join(code) {
      const room = findRoom(code);
      if (!room) return { error: 'room-not-found' };
      if (room.seats.B?.token) return { error: 'room-full' };
      if (room.seats.B) return open(room.code, 'B');
      return open(room.code, 'B');
    },

    auth(code, token) {
      const room = findRoom(code);
      if (!room || !token) return null;
      for (const seat of ['A', 'B']) {
        if (room.seats[seat]?.token === token) return { room, seat };
      }
      return null;
    },

    has(code) { return Boolean(findRoom(code)); },

    // 客户端用：把自己这份快照发出去（state 已脱敏）
    snapshot(room, seat) {
      const view = viewFor(room.state, seat);
      // publicLog / privateLog 是给界面看的纯文本，里面会带「种子 12345」，这里统一抹掉
      const scrub = (list) => (Array.isArray(list) ? list.map(stripSeed) : list);
      return {
        code: room.code,
        gameId: room.gameId,
        seq: room.state.seq,
        you: seat,
        over: Boolean(room.state.winner),
        seats: { A: Boolean(room.seats.A), B: Boolean(room.seats.B) },
        state: redactState(room.state, seat),
        view: { ...view, publicLog: scrub(view.publicLog), privateLog: scrub(view.privateLog) },
        events: visibleEventsFor(room.state, seat),
      };
    },

    act(room, seat, cmd) {
      if (!cmd || typeof cmd !== 'object') return { error: 'bad-command' };
      if (!canAct(room.state, seat)) return { error: 'not-your-turn' };
      // 客户端不许替别人提交
      if (cmd.playerId && cmd.playerId !== seat) return { error: 'not-your-seat' };
      room.touched = Date.now();
      // 双方同时提交时会有「快照还没到、指令已经过时」的竞态（比如能力牌阶段刚结束，
      // 另一条 PLAY_FUNCTION 才到）。这属于正常对局流程，不该是服务器错误：
      // 统一回 { error: 'rejected', message }，服务器记一条日志。
      try {
        apply(room.state, { ...cmd, playerId: seat });
      } catch (err) {
        console.warn('[room] 指令被拒:', seat, cmd.type, err.message);
        return { error: 'rejected', message: err.message };
      }
      return { ok: true, seq: room.state.seq };
    },

    rematch(room) {
      room.state = newGame();
      room.gameId = randomUUID();
      room.touched = Date.now();
      return { ok: true, gameId: room.gameId };
    },

    on(code, seat, fn) {
      const room = findRoom(code);
      if (!room) return () => {};
      room.listeners[seat].add(fn);
      return () => room.listeners[seat].delete(fn);
    },

    // 有变化就推给房间里两个座位（各自脱敏）
    publish(room) {
      if (!room) return;
      for (const seat of ['A', 'B']) {
        for (const fn of [...room.listeners[seat]]) {
          try { fn(this.snapshot(room, seat)); }
          catch { room.listeners[seat].delete(fn); } // 这个通道断了，别连累另一家
        }
      }
    },

    count() { return rooms.size; },
  };
}