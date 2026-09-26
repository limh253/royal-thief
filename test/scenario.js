import { createState, advance, apply, other } from '../src/engine.js';
import { RULES } from '../src/rules.js';

// 构造确定性局面：显式指定双方手牌与牌堆，剩余卡牌全部放入弃牌堆（保持卡牌守恒）。
export function scenario({ seed = 1, A = [], B = [], deck = [], startPhase = 'function', cards = {} } = {}) {
  const state = createState(seed, { cards });
  const used = new Set([...A, ...B, ...deck]);
  state.players.A.hand = A.slice();
  state.players.B.hand = B.slice();
  state.deck = deck.slice();
  state.discard = Object.keys(state.cards).filter((id) => !used.has(id));
  state.events = [];
  state.seq = 0;
  state.phase = startPhase;
  advance(state);
  return state;
}

// 临时覆盖规则参数，测试结束后恢复。
export function withRules(overrides, fn) {
  const saved = {};
  for (const k of Object.keys(overrides)) {
    saved[k] = RULES[k];
    RULES[k] = overrides[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(saved)) RULES[k] = saved[k];
  }
}

// 能力牌阶段现在是【双方同时】：测试里默认两边都跳过，需要谁出牌就单独指定
export function passFunction(state, seats = ['A', 'B']) {
  for (const seat of seats) {
    const p = state.pending;
    if (p?.kind !== 'function-phase' || p.submitted.includes(seat)) continue;
    apply(state, { type: 'PASS_FUNCTION', playerId: seat });
  }
}

export function playFunction(state, seat, cmd) {
  apply(state, { type: 'PLAY_FUNCTION', playerId: seat, ...cmd });
  passFunction(state, [other(seat)]);
}
export function info(state, id) {
  const c = state.cards[id];
  return `${id}:${c.kind === 'person' ? `人(${c.align})` : c.name}`;
}