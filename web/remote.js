// 联机会话适配器：把 web/app.js 需要的 ui.s 契约（和 session.js 一模一样）接到房间服务器上。
//
// 与本地 session.js 的区别：
//   · state 是服务器下发的「脱敏状态」，不是真状态；view 也是服务器算好的那一份
//   · act() 不本地执行，而是 POST 给服务器，等服务器把新快照从 SSE 推回来
//   · actor() 一律返回自己的座位：联机是同时暗置宣告，两边都要能操作
//     （具体「该不该由我操作」由 promptHtml 里的 online 分支判断）
import { apiUrl } from './server-url.js';

const rtRemoteMirror = (id) => (id === 'A' ? 'B' : 'A');

export function createRemoteSession({ code, token, seat, onSnapshot, onStatus }) {
  const emptyState = {
    cards: {}, deck: [], discard: [],
    players: { A: { hand: [], silenced: false }, B: { hand: [], silenced: false } },
    turn: 'A', round: 1, phase: 'draw', atWarCounter: 0, berserk: { A: false, B: false },
    pending: null, winner: null, events: [], seq: 0,
  };

  const post = async (path, body) => {
    const res = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
  };

  const S = {
    mode: 'online',
    code,
    token,
    seat,
    seed: code,
    gameId: null,
    ready: false,
    status: 'connecting',
    state: emptyState,
    viewCache: null,
    queue: [],
    es: null,
    hb: null,
    lastAt: 0,
    trace: [],
    note(src, snap) {
      S.lastAt = Date.now();
      S.trace.push({ src, seq: snap?.seq ?? null, kind: snap?.state?.pending?.kind ?? "-", w: snap?.state?.winner ?? null });
      if (S.trace.length > 80) S.trace.shift();
    },

    // 兜底：只要牌局没结束、还停在某个阶段等人，超过 6 秒没收到任何推送就自己补拉一次。
    // SSE 万一丢了一条，牌桌也能自己恢复，不用刷新页面。
    watchdog() {
      const st = S.state;
      if (!st || st.winner || !st.pending) return;
      if (S.status !== 'online') return;
      if (Date.now() - S.lastAt < 6000) return;
      S.poke();
    },

    isBot() { return false; },
    view() { return S.viewCache; },
    botCommand() { return null; },
    eventsSince(seq) { return S.queue.filter((e) => e.seq > seq); },

    // 联机是「双方同时暗置」，所以只要牌局没结束、还有待办，就当作轮到自己
    actor() {
      const st = S.state;
      const p = st?.pending;
      if (!st || st.winner || !p) return null;
      return seat;
    },
    waitingFor() {
      const p = S.state?.pending;
      if (p?.kind !== 'declare-phase' && p?.kind !== 'function-phase') return null;
      return p.submitted.includes(seat) ? rtRemoteMirror(seat) : seat;
    },

    act(_playerId, cmd) {
      post('/api/room/act', { code, token, cmd })
        .then((r) => {
          // 服务器对「不该你操作 / 指令过时」回 200 + ok:false，不当成故障
          if (!r.ok || r.body?.error) onStatus?.('rejected', r.body?.error);
          else S.poke();
        })
        .catch(() => onStatus?.('offline'));
    },

    async poke() {
      try {
        const r = await fetch(apiUrl(`/api/room/state?code=${encodeURIComponent(code)}&token=${token}`));
        if (!r.ok) { onStatus?.('rejected', 'bad-token'); return; }
        const snap = await r.json();
        S.note('poke', snap);
        onSnapshot?.(snap, 'poke');
      } catch { onStatus?.('offline'); }
    },

    async rematch() {
      const r = await post('/api/room/rematch', { code, token });
      if (!r.ok) onStatus?.('rejected', r.body?.error);
      return r.ok;
    },

    connect() {
      if (typeof EventSource !== 'function') { onStatus?.('no-sse'); return; }
      S.close();
      const es = new EventSource(apiUrl(`/api/room/sse?code=${encodeURIComponent(code)}&token=${token}`));
      S.es = es;
      es.onopen = () => { S.status = 'online'; onStatus?.('online'); S.poke(); };
      es.onmessage = (ev) => {
        try {
          const snap = JSON.parse(ev.data);
          S.status = 'online';
          S.note('sse', snap);
          onSnapshot?.(snap, 'sse');
        } catch { /* 半截数据包就丢掉，等下一条 */ }
      };
      es.onerror = () => { S.status = 'reconnecting'; onStatus?.('reconnecting'); };
      if (!S.hb) S.hb = setInterval(() => S.watchdog(), 3000);
    },

    close() {
      if (S.es) { try { S.es.close(); } catch { /* 忽略 */ } S.es = null; }
      if (S.hb) { clearInterval(S.hb); S.hb = null; }
    },
  };
  return S;
}