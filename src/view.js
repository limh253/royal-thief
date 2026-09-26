import { label, isFunctionCard } from './cards.js';
import { RULES } from './rules.js';

const mirror = (id) => (id === 'A' ? 'B' : 'A');

// 每个玩家只拿到自己该看的信息：自己手牌明文，对手手牌只给"是否为空"。
export function viewFor(state, playerId) {
  const me = state.players[playerId];
  const foe = state.players[mirror(playerId)];
  const info = (id) => ({ id, label: label(state.cards[id]), kind: state.cards[id].kind });
  return {
    you: playerId,
    turn: state.turn,
    round: state.round,
    phase: state.phase,
    yourHand: me.hand.map(info),
    yourHandCount: me.hand.length,
    yourSilenced: me.silenced,
    yourSeenThisTurn: me.seenThisTurn.map(info),
    yourBerserkEligible: Boolean(state.berserk[playerId]),
    opponentHandCount: RULES.revealHandCounts ? foe.hand.length : null,
    opponentHandEmpty: foe.hand.length === 0,
    deckCount: RULES.revealDeckCount ? state.deck.length : null,
    deckEmpty: state.deck.length === 0,
    discard: RULES.revealDiscard ? state.discard.map(info) : null,
    atWarCounter: state.atWarCounter,
    publicLog: state.events.filter((e) => e.scope === 'all').map((e) => e.text),
    privateLog: state.events.filter((e) => e.scope === 'private' && e.player === playerId).map((e) => e.text),
    pending: pendingView(state, playerId),
    winner: state.winner,
  };
}

function pendingView(state, playerId) {
  const p = state.pending;
  if (!p) return { kind: 'none' };
  if (p.kind === 'function-phase') {
    // 双方同时：自己交了就等对手，还没交就给出可打的能力牌
    const submitted = p.submitted.includes(playerId);
    const mine = state.players[playerId].hand.filter((id) => isFunctionCard(state.cards[id]));
    return {
      kind: 'function-phase',
      player: playerId,
      youSubmitted: submitted,
      waitingFor: submitted ? 'opponent' : 'you',
      hasFunction: mine.length > 0,
      playable: submitted ? [] : mine.map((id) => ({ id, label: label(state.cards[id]) })),
    };
  }
  if (p.kind === 'declare-phase') {
    const submitted = p.submitted.includes(playerId);
    return {
      kind: 'declare-phase',
      youSubmitted: submitted,
      waitingFor: submitted ? 'opponent' : 'you',
      yourFightable: state.players[playerId].hand
        .filter((id) => state.cards[id].kind === 'person')
        .map((id) => ({ id, label: label(state.cards[id]) })),
      yourItems: state.players[playerId].hand
        .filter((id) => state.cards[id].kind === 'item')
        .map((id) => ({ id, label: label(state.cards[id]) })),
    };
  }
  if (p.kind === 'battle-reward') {
    if (p.winner !== playerId) return { kind: 'battle-reward', text: '等待对手选择出战卡牌处理方式' };
    return { kind: 'battle-reward', winner: p.winner, options: ['keep', 'take'] };
  }
  return { kind: p.kind };
}