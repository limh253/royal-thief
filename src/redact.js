// 把服务端完整状态裁剪成「某个座位可以安全看到的状态壳」。
//
// 为什么需要它：web/app.js 的渲染层是直接读 state 的（st.players[x].hand / st.cards[id] / st.deck.length…），
// 而 viewFor() 只给出「该玩家能看到的语义信息」。联机时不能把完整 state 下发，
// 所以这里造一个「结构一样、但隐藏信息已被抹掉」的替身：
//   · 对手手牌 → 同长度的占位 id（渲染层只用 hand.length 画背面）
//   · 主牌堆    → 同长度的占位 id（渲染层只用 deck.length）
//   · 对手的背水一战 / 本回合窥探记录 → 一律清空
//   · 私有事件  → 只保留发给本人的；事件文案里的随机种子也抹掉（种子能反推整副牌序）
// 注意：真正给客户端的信息出口仍然是 viewFor()，这个函数只负责「渲染层别看到不该看的」。
const redactMirror = (id) => (id === 'A' ? 'B' : 'A');
const HIDDEN = '__hidden';
const FOE_BACKS = 3; // 对手手牌下发几张背面（真实张数不下发）
const EVENT_CAP = 800;

export function stripSeed(text) {
  return String(text ?? '').replace(/（种子\s*\d+）/g, '').replace(/\s*种子\s*\d+/g, '');
}

export function visibleEventsFor(state, seat) {
  const from = Math.max(0, state.events.length - EVENT_CAP);
  return state.events.slice(from)
    .filter((e) => e.scope === 'all' || (e.scope === 'private' && e.player === seat))
    .map((e) => {
      const data = { ...(e.data ?? {}) };
      delete data.seed;
      return { seq: e.seq, type: e.type, scope: e.scope, player: e.player, text: stripSeed(e.text), data };
    });
}

export function redactState(state, seat) {
  const foe = redactMirror(seat);
  const over = Boolean(state.winner);
  // 对手手牌一律发「固定张数」的占位牌：连「对手还剩几张」这种能反推局势的信息也不下发
  const handOf = (who) => {
    if (over || who === seat) return state.players[who].hand.slice();
    if (!state.players[who].hand.length) return [];
    return Array.from({ length: FOE_BACKS }, (_, i) => HIDDEN + i);
  };
  return {
    code: state.code ?? null,
    cards: state.cards,
    deck: state.deck.map((_, i) => HIDDEN + i),
    discard: state.discard.slice(),
    players: {
      A: { hand: handOf('A'), silenced: state.players.A.silenced, seenThisTurn: [] },
      B: { hand: handOf('B'), silenced: state.players.B.silenced, seenThisTurn: [] },
    },
    turn: state.turn,
    round: state.round,
    phase: state.phase,
    atWarCounter: state.atWarCounter,
    berserk: over ? { A: state.berserk.A, B: state.berserk.B } : { [seat]: state.berserk[seat], [foe]: false },
    pending: state.pending ? { ...state.pending, submitted: state.pending.submitted ? state.pending.submitted.slice() : undefined } : null,
    winner: state.winner,
    events: visibleEventsFor(state, seat),
    seq: state.seq,
  };
}