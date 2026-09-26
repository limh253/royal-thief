import { isPerson, isItem, isFunctionCard } from './cards.js';
import { apply } from './engine.js';

// 仅用于自动对局 / 不变式测试的随机策略机器人，使用独立随机源，不污染牌堆随机数。
function mulberry(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeBot(seed, opts = {}) {
  const rnd = mulberry(seed);
  const fightChance = opts.fightChance ?? 0.65;
  return {
    next(state, playerId) {
      const p = state.pending;
      if (!p) return null;
      if (p.kind === 'function-phase') {
        if (p.submitted.includes(playerId)) return null;
        const playable = state.players[playerId].hand.filter((id) => isFunctionCard(state.cards[id]));
        if (!playable.length || rnd() < 0.25) return { type: 'PASS_FUNCTION', playerId };
        const cardId = playable[Math.floor(rnd() * playable.length)];
        const cmd = { type: 'PLAY_FUNCTION', playerId, cardId };
        if (state.cards[cardId].name === '推心置腹') {
          const mine = state.players[playerId].hand.filter((id) => id !== cardId && !isFunctionCard(state.cards[id]));
          if (mine.length) cmd.giveCardId = mine[Math.floor(rnd() * mine.length)];
        }
        return cmd;
      }
      if (p.kind === 'declare-phase') {
        if (p.submitted.includes(playerId)) return null;
        const persons = state.players[playerId].hand.filter((id) => isPerson(state.cards[id]));
        if (!persons.length || rnd() > fightChance) return { type: 'DECLARE', playerId, fight: false };
        const personCardId = persons[Math.floor(rnd() * persons.length)];
        const items = state.players[playerId].hand.filter((id) => isItem(state.cards[id]));
        const cmd = { type: 'DECLARE', playerId, fight: true, personCardId };
        if (items.length && rnd() < 0.5) cmd.itemCardId = items[Math.floor(rnd() * items.length)];
        return cmd;
      }
      if (p.kind === 'battle-reward') {
        if (p.winner !== playerId) return null;
        return { type: 'CHOOSE_REWARD', playerId, option: rnd() < 0.5 ? 'keep' : 'take' };
      }
      return null;
    },
  };
}

// 驱动一局自动对局，返回最终 state。
export function autoplay(state, seed = 7, opts = {}) {
  const bots = { A: makeBot(seed * 2 + 1, opts), B: makeBot(seed * 2 + 2, opts) };
  let guard = 0;
  while (!state.winner) {
    if (++guard > 20000) throw new Error('autoplay 无法结束');
    const p = state.pending;
    if (!p) { throw new Error('autoplay: 没有待处理指令却未结束'); }
    const actor = p.kind === 'function-phase' ? (p.submitted.includes('A') ? 'B' : 'A')
      : p.kind === 'declare-phase' ? (p.submitted.includes('A') ? 'B' : 'A')
      : p.winner;
    const cmd = bots[actor].next(state, actor);
    if (!cmd) throw new Error(`bot 无法为 ${actor} 生成指令 (${p.kind})`);
    try {
      applySafe(state, cmd);
    } catch (err) {
      if (cmd.type === 'CHOOSE_REWARD' && cmd.option === 'take') {
        applySafe(state, { ...cmd, option: 'keep' });
      } else {
        throw err;
      }
    }
  }
  return state;
}

function applySafe(state, cmd) {
  return apply(state, cmd);
}