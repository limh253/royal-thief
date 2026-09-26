import {
  buildCards, isPerson, isItem, isFunctionCard, isCrown, isWeapon, isCloak, label,
} from './cards.js';
import { RULES, compareIdentity, identityOf } from './rules.js';
import { randInt, shuffle } from './rng.js';
import { pushEvent, complete } from './log.js';

export const other = (id) => (id === 'A' ? 'B' : 'A');

export function removeFrom(arr, id) {
  const i = arr.indexOf(id);
  if (i < 0) throw new Error(`卡牌不在集合中: ${id}`);
  arr.splice(i, 1);
  return id;
}

function mkPlayer(id) {
  return { id, hand: [], silenced: false, seenThisTurn: [] };
}

// ---------------------------------------------------------------- 建局

// 低层建局：只构造状态与洗牌，不发作手牌，便于测试注入确定性手牌。
export function createState(seed = 1, opts = {}) {
  const spec = opts.cards ?? {};
  // 止戈张数由 RULES 统一控制，便于一行切换终局条款是否可达
  const cards = buildCards({
    ...spec,
    functionCopies: { 止戈: RULES.zhiGeCopies, ...(spec.functionCopies ?? {}) },
  });
  const state = {
    seed,
    rngState: (seed >>> 0) || 0x9e3779b9,
    cards,
    deck: [],
    discard: [],
    players: { A: mkPlayer('A'), B: mkPlayer('B') },
    turn: 'A',
    round: 1,
    turnIndex: 0,
    phase: 'draw',
    atWarCounter: 0,
    stalemateRounds: 0,
    decisiveThisRound: 0,
    turnZhiGePlayed: false,
    berserk: { A: false, B: false },
    declaration: null,            // { A:{fight,personCardId,itemCardId,identity}, B:{...} }
    battleZone: { A: [], B: [] }, // 已锁定、暂时离手的出战卡牌
    pending: null,
    winner: null,
    events: [],
    seq: 0,
  };
  state.deck = shuffle(state, Object.keys(cards));
  return state;
}

export function dealInitial(state) {
  for (const id of ['A', 'B']) {
    for (let i = 0; i < RULES.initialHandSize; i++) drawTop(state, id);
  }
  pushEvent(state, { type: 'setup', scope: 'all', text: `开局：洗牌完成，A / B 各抽 ${RULES.initialHandSize} 张初始手牌（种子 ${state.seed}）` });
  return state;
}

export function createGame(seed = 1, opts = {}) {
  const state = createState(seed, opts);
  dealInitial(state);
  advance(state);
  return state;
}

// ---------------------------------------------------------------- 基础操作

export function drawTop(state, playerId) {
  if (state.deck.length === 0) return null;
  const cardId = state.deck.shift();
  acquire(state, playerId, cardId);
  return cardId;
}

// 所有获得卡牌的路径统一走这里，保证皇冠上限规则不会被绕过。
export function acquire(state, playerId, cardId) {
  const c = state.cards[cardId];
  const p = state.players[playerId];
  if (isCrown(c) && p.hand.some((id) => isCrown(state.cards[id]))) {
    state.discard.push(cardId);
    pushEvent(state, { type: 'crown-overflow', scope: 'all', text: `${playerId} 皇冠超出上限，直接弃入弃牌堆`, data: { player: playerId } });
    return { placed: 'discard', overflow: true };
  }
  p.hand.push(cardId);
  return { placed: 'hand', overflow: false };
}

function returnBattleCards(state, playerId) {
  for (const cid of state.battleZone[playerId].slice()) {
    removeFrom(state.battleZone[playerId], cid);
    acquire(state, playerId, cid);
  }
}

function discardBattleCards(state, playerId) {
  for (const cid of state.battleZone[playerId].slice()) {
    removeFrom(state.battleZone[playerId], cid);
    state.discard.push(cid);
  }
}

function checkZeroHands(state) {
  const zeroA = state.players.A.hand.length === 0;
  const zeroB = state.players.B.hand.length === 0;
  if (!zeroA && !zeroB) return false;
  if (zeroA && zeroB) {
    state.winner = { kind: 'draw', reason: '双方手牌同时归零' };
  } else {
    state.winner = { kind: 'player', id: zeroA ? 'B' : 'A', reason: `${zeroA ? 'A' : 'B'} 手牌归零` };
  }
  pushEvent(state, { type: 'game-over', scope: 'all', text: `游戏结束：${state.winner.reason}` });
  return true;
}

function endByHands(state, reason) {
  const a = state.players.A.hand.length;
  const b = state.players.B.hand.length;
  if (a === b) state.winner = { kind: 'draw', reason: `${reason}；手牌 A=${a} / B=${b}，平局` };
  else state.winner = { kind: 'player', id: a > b ? 'A' : 'B', reason: `${reason}；手牌 A=${a} / B=${b}` };
  pushEvent(state, { type: 'game-over', scope: 'all', text: `游戏结束：${state.winner.reason}` });
}

// ---------------------------------------------------------------- 状态机

export function advance(state) {
  let guard = 0;
  while (!state.winner && !state.pending) {
    if (++guard > 500) throw new Error('advance() 无法推进，疑似死循环');
    switch (state.phase) {
      case 'draw': phaseDraw(state); break;
      case 'function': phaseFunction(state); break;
      case 'berserk': phaseBerserk(state); break;
      case 'declare': phaseDeclare(state); break;
      case 'battle': phaseBattle(state); break;
      case 'end': phaseEnd(state); break;
      default: throw new Error(`未知阶段: ${state.phase}`);
    }
  }
  return state;
}

function phaseDraw(state) {
  const p = state.turn;
  if (state.deck.length === 0) {
    pushEvent(state, { type: 'draw-skip', scope: 'all', text: `主牌堆已空，${p} 跳过抽牌` });
  } else {
    drawTop(state, p);
    pushEvent(state, { type: 'draw', scope: 'all', text: `${p} 抽牌阶段：抽入 1 张` });
  }
  state.phase = 'function';
}

function phaseFunction(state) {
  // 能力牌阶段改成【双方同时】：两边各自私下选一张能力牌（或跳过），
  // 都提交完再一次性结算（按 A → B 顺序执行），和对抗宣告一样是 commit-reveal。
  const pending = { kind: 'function-phase', submitted: [], picks: {} };
  for (const id of ['A', 'B']) {
    if (!state.players[id].silenced) continue;
    state.players[id].silenced = false; // 沉默标记在功能牌阶段开始前清除
    pending.submitted.push(id);
    pending.picks[id] = null;
    pushEvent(state, { type: 'silenced', scope: 'all', text: id + ' 本回合被沉默：不能打出任何功能牌' });
  }
  if (pending.submitted.length === 2) { state.phase = 'berserk'; return; }
  state.pending = pending;
}
function phaseBerserk(state) {
  for (const id of ['A', 'B']) {
    const h = state.players[id].hand;
    state.berserk[id] = h.length === 1 && isPerson(state.cards[h[0]]);
    if (state.berserk[id]) {
      pushEvent(state, {
        type: 'berserk',
        scope: 'private',
        player: id,
        text: `背水一战判定（仅你可见）：手牌仅剩 1 张${label(state.cards[h[0]])}，若本回合出战将临时变身为${state.cards[h[0]].align === '善' ? '骑士' : '匪徒'}`,
      });
    }
  }
  state.phase = 'declare';
}

function phaseDeclare(state) {
  if (!state.declaration) {
    state.declaration = {};
    state.pending = { kind: 'declare-phase', submitted: [] };
  }
}

function phaseBattle(state) {
  const A = state.declaration.A;
  const B = state.declaration.B;
  const ids = ['A', 'B'];

  if (!A.fight || !B.fight) {
    for (const id of ids) if (state.declaration[id].fight) returnBattleCards(state, id);
    for (const passer of ids.filter((id) => !state.declaration[id].fight)) {
      if (passer !== state.turn && !RULES.passPenaltyAppliesToAllPassers) {
        pushEvent(state, { type: 'no-penalty', scope: 'all', text: `${passer} 选择不出战（非行动方，按配置免罚）` });
        continue;
      }
      applyPassPenalty(state, passer);
    }
    if (!state.winner) {
      pushEvent(state, { type: 'battle-skipped', scope: 'all', text: '未形成双方对战，跳过战斗结算' });
      state.phase = 'end';
    }
    return;
  }
  resolveBattle(state);
}

function applyPassPenalty(state, passer) {
  const taker = other(passer);
  const pool = state.players[passer].hand.filter((id) => !isFunctionCard(state.cards[id]));
  if (pool.length === 0) {
    pushEvent(state, { type: 'penalty-none', scope: 'all', text: `${passer} 不出战，但手牌中没有可被夺取的卡牌（功能牌不可转移）` });
    checkZeroHands(state);
    return;
  }
  const cardId = pool[randInt(state, pool.length)];
  removeFrom(state.players[passer].hand, cardId);
  acquire(state, taker, cardId);
  pushEvent(state, { type: 'penalty', scope: 'all', text: `${passer} 不出战惩罚：${taker} 随机夺走其 1 张手牌`, data: { passer, taker } });
  checkZeroHands(state);
}

function resolveBattle(state) {
  const ids = ['A', 'B'];
  const combo = (id) => {
    const d = state.declaration[id];
    return {
      person: d.personCardId ? label(state.cards[d.personCardId]) : null,
      item: d.itemCardId ? label(state.cards[d.itemCardId]) : null,
      identity: d.identity,
      fight: d.fight,
    };
  };
  pushEvent(state, {
    type: 'battle-reveal',
    scope: 'all',
    text: `同时亮牌：A 出战 [${combo('A').person}${combo('A').item ? ' + ' + combo('A').item : ''}]，B 出战 [${combo('B').person}${combo('B').item ? ' + ' + combo('B').item : ''}]`,
    data: { A: combo('A'), B: combo('B') },
  });

  // 1) 贼效果优先结算：弃隐身衣 + 夺取对方出战组合里的武器
  for (const id of ids) {
    const d = state.declaration[id];
    if (!d.itemCardId || !isCloak(state.cards[d.itemCardId])) continue;
    removeFrom(state.battleZone[id], d.itemCardId);
    state.discard.push(d.itemCardId);
    pushEvent(state, { type: 'thief-cloak', scope: 'all', text: `${id} 触发贼效果：弃掉隐身衣`, data: { side: id } });
    const foe = other(id);
    const weapon = state.battleZone[foe].find((cid) => isWeapon(state.cards[cid]));
    if (weapon) {
      removeFrom(state.battleZone[foe], weapon);
      acquire(state, id, weapon);
      pushEvent(state, { type: 'thief-steal', scope: 'all', text: `${id} 夺取 ${foe} 出战组合中的武器`, data: { side: id, from: foe, stolen: true } });
    } else {
      pushEvent(state, { type: 'thief-steal', scope: 'all', text: `${id} 的贼效果未夺取到武器（对手出战组合无武器）`, data: { side: id, from: foe, stolen: false } });
    }
  }

  const ia = state.declaration.A.identity;
  const ib = state.declaration.B.identity;
  const cmp = compareIdentity(ia, ib);

  if (cmp === 'draw') {
    const how = RULES.drawDiscardsBattleCards ? '双方出战卡牌全部进弃牌堆' : '双方出战卡牌全部返还';
    pushEvent(state, { type: 'battle-draw', scope: 'all', text: `身份判定：A = ${ia}，B = ${ib} → 无克制关系，平局；${how}`, data: { ia, ib } });
    for (const id of ids) {
      if (RULES.drawDiscardsBattleCards) discardBattleCards(state, id);
      else returnBattleCards(state, id);
    }
    checkZeroHands(state);
    state.phase = 'end';
    return;
  }

  state.decisiveThisRound += 1;
  const winner = cmp === 'a' ? 'A' : 'B';
  const loser = other(winner);
  pushEvent(state, { type: 'battle-win', scope: 'all', text: `身份判定：A = ${ia}，B = ${ib} → ${winner} 胜出`, data: { ia, ib, winner } });
  state.pending = { kind: 'battle-reward', winner, loser };
}

function projectTakeHand(state, winner, loser) {
  const hand = state.players[winner].hand.slice();
  let hasCrown = hand.some((id) => isCrown(state.cards[id]));
  for (const cid of state.battleZone[loser]) {
    if (isCrown(state.cards[cid]) && hasCrown) continue;
    if (isCrown(state.cards[cid])) hasCrown = true;
    hand.push(cid);
  }
  return hand;
}

function applyReward(state, winner, option) {
  const loser = other(winner);
  if (option === 'take') {
    if (projectTakeHand(state, winner, loser).length === 0) {
      throw new Error('禁止选择会导致自己手牌归零的处理方式');
    }
    for (const cid of state.battleZone[winner].slice()) {
      removeFrom(state.battleZone[winner], cid);
      state.discard.push(cid);
    }
    for (const cid of state.battleZone[loser].slice()) {
      removeFrom(state.battleZone[loser], cid);
      acquire(state, winner, cid);
    }
    pushEvent(state, { type: 'reward', scope: 'private', player: winner, text: '你选择了②：弃掉自己的出战卡牌，收入对手的出战卡牌', data: { option: 'take' } });
  } else {
    returnBattleCards(state, winner);
    for (const cid of state.battleZone[loser].slice()) {
      removeFrom(state.battleZone[loser], cid);
      state.discard.push(cid);
    }
    pushEvent(state, { type: 'reward', scope: 'private', player: winner, text: '你选择了①：保留自己的出战卡牌，对手出战卡牌送入弃牌堆', data: { option: 'keep' } });
  }
  // 败者只能看到卡牌最终变化结果，看不到胜者选了哪个选项
  pushEvent(state, { type: 'battle-settled', scope: 'all', text: '战斗结算完成' });
  checkZeroHands(state);
}

function phaseEnd(state) {
  state.berserk = { A: false, B: false };
  state.declaration = null;
  state.battleZone = { A: [], B: [] };
  state.players.A.seenThisTurn = [];
  state.players.B.seenThisTurn = [];
  if (!state.turnZhiGePlayed) state.atWarCounter = 0;
  state.turnZhiGePlayed = false;

  const endOfRound = state.turn === 'B';
  if (endOfRound) {
    if (state.deck.length === 0) {
      state.stalemateRounds = state.decisiveThisRound === 0 ? state.stalemateRounds + 1 : 0;
    }
    state.decisiveThisRound = 0;
    state.round += 1;
  }

  if (state.deck.length === 0 && state.atWarCounter >= RULES.zhiGeGoal) {
    return endByHands(state, '止戈计数达成且主牌堆已空');
  }
  if (state.deck.length === 0 && state.stalemateRounds >= RULES.stalemateRounds) {
    return endByHands(state, `主牌堆耗尽后连续 ${RULES.stalemateRounds} 个完整回合未产生战斗胜负`);
  }
  if (endOfRound && state.round > RULES.maxRounds) {
    return endByHands(state, `达到全局回合上限 ${RULES.maxRounds}`);
  }

  state.turn = other(state.turn);
  state.turnIndex += 1;
  state.phase = 'draw';
}

// ---------------------------------------------------------------- 功能牌

function playFunction(state, playerId, pick) {
  const cardId = pick.cardId;
  const hand = state.players[playerId].hand;
  if (!hand.includes(cardId)) return false; // 已被别的效果移走，视为空过
  const card = state.cards[cardId];
  const foe = other(playerId);
  removeFrom(hand, cardId);
  state.discard.push(cardId);
  pushEvent(state, { type: 'play-function', scope: 'all', text: `${playerId} 打出功能牌【${card.name}】`, data: { player: playerId, name: card.name } });

  let zhiGe = false;
  switch (card.name) {
    case '洞若观火': {
      const pool = state.players[foe].hand;
      if (pool.length === 0) break;
      const seenId = pool[randInt(state, pool.length)];
      state.players[playerId].seenThisTurn.push(seenId);
      pushEvent(state, { type: 'peek', scope: 'private', player: playerId, text: `你探查到对手手牌中的 1 张：${label(state.cards[seenId])}（本回合内可回看）`, data: { seenId } });
      break;
    }
    case '重整': {
      const persons = state.deck.filter((id) => isPerson(state.cards[id]));
      if (persons.length === 0) break;
      const got = persons[randInt(state, persons.length)];
      removeFrom(state.deck, got);
      acquire(state, playerId, got);
      pushEvent(state, { type: 'regroup', scope: 'private', player: playerId, text: `重整：从主牌堆抽到 ${label(state.cards[got])} 加入手牌`, data: { gotId: got } });
      break;
    }
    case '颠倒是非': {
      const pool = state.players[foe].hand.filter((id) => isPerson(state.cards[id]));
      if (pool.length === 0) break;
      const target = state.cards[pool[randInt(state, pool.length)]];
      target.align = target.align === '善' ? '恶' : '善';
      break;
    }
    case '铸剑为犁': {
      const pool = state.players[foe].hand.filter((id) => isWeapon(state.cards[id]));
      if (pool.length === 0) break;
      const target = pool[randInt(state, pool.length)];
      removeFrom(state.players[foe].hand, target);
      state.discard.push(target);
      break;
    }
    case '推心置腹': {
      const giveId = pick.giveCardId;
      const myPool = hand.filter((id) => !isFunctionCard(state.cards[id]));
      const foePool = state.players[foe].hand.filter((id) => !isFunctionCard(state.cards[id]));
      if (!giveId || !myPool.includes(giveId) || foePool.length === 0) break;
      const takeId = foePool[randInt(state, foePool.length)];
      removeFrom(hand, giveId);
      removeFrom(state.players[foe].hand, takeId);
      const giveRes = acquire(state, foe, giveId);
      const takeRes = acquire(state, playerId, takeId);
      pushEvent(state, {
        type: 'swap',
        scope: 'all',
        text: `推心置腹：${playerId} 交出 ${label(state.cards[giveId])}，换得 ${label(state.cards[takeId])}`
          + (giveRes.overflow || takeRes.overflow ? '（其中一张因皇冠上限溢出弃置）' : ''),
        data: { player: playerId, giveId, takeId },
      });
      break;
    }
    case '沉默': {
      state.players[foe].silenced = true;
      pushEvent(state, { type: 'silence', scope: 'private', player: playerId, text: '沉默施加成功：对手下一回合无法打出功能牌' });
      break;
    }
    case '止戈': {
      state.atWarCounter = Math.min(RULES.zhiGeGoal, state.atWarCounter + 1);
      state.turnZhiGePlayed = true;
      pushEvent(state, { type: 'zhige', scope: 'all', text: `${playerId} 打出止戈：跳过背水一战判定、对抗宣告与战斗结算（止戈计数 ${state.atWarCounter}）`, data: { player: playerId } });
      zhiGe = true; // 止戈：本阶段结算完直接跳到回合结束
      break;
    }
    default:
      throw new Error(`未实现的功能牌：${card.name}`);
  }
  if (!zhiGe) complete(state);
  checkZeroHands(state);
  return zhiGe;
}

// 收到某个座位的能力牌提交；两边都交完才结算
function submitFunction(state, p, command) {
  const playerId = command.playerId;
  if (playerId !== 'A' && playerId !== 'B') throw new Error('玩家必须是 A 或 B');
  if (p.submitted.includes(playerId)) throw new Error(playerId + ' 已提交本回合能力牌，不可修改');
  if (command.type === 'PLAY_FUNCTION') {
    checkFunctionPick(state, playerId, command);
    p.picks[playerId] = { cardId: command.cardId, giveCardId: command.giveCardId ?? null };
  } else if (command.type === 'PASS_FUNCTION') {
    p.picks[playerId] = null;
  } else {
    throw new Error('当前需要 PLAY_FUNCTION 或 PASS_FUNCTION');
  }
  p.submitted.push(playerId);
  pushEvent(state, { type: 'function-locked', scope: 'all', text: playerId + ' 已提交本回合能力牌（同时暗置，全部提交后依次结算）' });
  if (p.submitted.length < 2) return;
  state.pending = null;
  resolveFunctionPhase(state, p);
}

// 提交时就校验，别等到结算才发现这张牌根本打不出来
function checkFunctionPick(state, playerId, command) {
  const hand = state.players[playerId].hand;
  const cardId = command.cardId;
  if (!cardId || !hand.includes(cardId) || !isFunctionCard(state.cards[cardId])) {
    throw new Error('打出的必须是手牌中的功能牌');
  }
  if (state.cards[cardId].name === '推心置腹') {
    // 拿不出非功能牌（或指了张功能牌）不算非法提交：交换自然失败，公开只提示"结算完成"
    const pool = hand.filter((id) => id !== cardId && !isFunctionCard(state.cards[id]));
    if (command.giveCardId && !pool.includes(command.giveCardId)) command.giveCardId = null;
  }
}

function resolveFunctionPhase(state, p) {
  let zhiGe = false;
  for (const seat of ['A', 'B']) {
    if (state.winner) break;
    const pick = p.picks[seat] ?? null;
    if (!pick) {
      pushEvent(state, { type: 'pass-function', scope: 'all', text: seat + ' 不打出功能牌' });
      continue;
    }
    if (playFunction(state, seat, pick)) zhiGe = true;
  }
  state.phase = (zhiGe || state.winner) ? 'end' : 'berserk';
}

// ---------------------------------------------------------------- 指令入口

export function apply(state, command) {
  if (state.winner) throw new Error('游戏已结束，无法继续操作');
  const p = state.pending;
  if (!p) {
    advance(state);
    return state;
  }
  switch (p.kind) {
    case 'function-phase': {
      submitFunction(state, p, command);
      break;
    }
    case 'declare-phase': {
      if (command.type !== 'DECLARE') throw new Error('当前需要 DECLARE 宣告');
      declare(state, p, command);
      break;
    }
    case 'battle-reward': {
      if (command.type !== 'CHOOSE_REWARD') throw new Error('当前需要 CHOOSE_REWARD');
      if (command.playerId !== p.winner) throw new Error('只有胜者可以选择处理方式');
      if (command.option !== 'keep' && command.option !== 'take') throw new Error('option 必须是 keep 或 take');
      state.pending = null;
      applyReward(state, p.winner, command.option);
      if (!state.winner) state.phase = 'end';
      break;
    }
    default:
      throw new Error(`未知 pending: ${p.kind}`);
  }
  advance(state);
  return state;
}

function declare(state, p, command) {
  const playerId = command.playerId;
  if (playerId !== 'A' && playerId !== 'B') throw new Error('玩家必须是 A 或 B');
  if (p.submitted.includes(playerId)) throw new Error(`${playerId} 已锁定宣告，不可修改`);
  const hand = state.players[playerId].hand;
  let decl;
  if (command.fight !== true) {
    decl = { fight: false, personCardId: null, itemCardId: null, identity: null };
  } else {
    const personCardId = command.personCardId;
    if (!personCardId || !hand.includes(personCardId) || !isPerson(state.cards[personCardId])) {
      throw new Error('出战组合必须包含一张自己手牌中的人牌');
    }
    const itemCardId = command.itemCardId ?? null;
    if (itemCardId && (!hand.includes(itemCardId) || !isItem(state.cards[itemCardId]))) {
      throw new Error('出战组合至多搭配一张自己手牌中的道具牌');
    }
    const identity = identityOf(
      { person: state.cards[personCardId], item: itemCardId ? state.cards[itemCardId] : null },
      state.berserk[playerId],
    );
    decl = { fight: true, personCardId, itemCardId, identity };
    removeFrom(hand, personCardId);
    state.battleZone[playerId].push(personCardId);
    if (itemCardId) {
      removeFrom(hand, itemCardId);
      state.battleZone[playerId].push(itemCardId);
    }
  }
  state.declaration[playerId] = decl;
  p.submitted.push(playerId);
  pushEvent(state, { type: 'declare-locked', scope: 'all', text: `${playerId} 已提交并锁定本回合宣告` });
  if (p.submitted.length === 2) {
    state.pending = null;
    state.phase = 'battle';
  }
}