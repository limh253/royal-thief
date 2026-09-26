import test from 'node:test';
import assert from 'node:assert/strict';
import { acquire, apply, createState, dealInitial } from '../src/engine.js';
import { RULES } from '../src/rules.js';
import { viewFor } from '../src/view.js';
import { scenario, withRules, passFunction, playFunction } from './scenario.js';

test('Q3：出战牌离手导致手牌为 0 时不判负，结算后按结果处理', () => {
  const s = scenario({ A: ['p1'], B: ['p7', 'p8'], deck: [] });
  passFunction(s);
  assert.equal(s.berserk.A, true, '手牌仅 1 张人牌 → 背水一战判定成立');
  apply(s, { type: 'DECLARE', playerId: 'A', fight: true, personCardId: 'p1' });
  assert.equal(s.players.A.hand.length, 0, '出战卡牌离手');
  assert.equal(s.winner, null, '出战窗口内不触发手牌归零判负');

  apply(s, { type: 'DECLARE', playerId: 'B', fight: false });
  assert.equal(s.winner, null);
  assert.ok(s.players.A.hand.includes('p1'), '未形成对战 → 出战牌返还');
});

test('Q7①：功能牌阶段打出最后一张手牌 → 立刻判负', () => {
  const s = scenario({ A: ['f1'], B: ['p7', 'p8'], deck: [] });
  playFunction(s, s.turn, { cardId: 'f1' });
  assert.equal(s.winner.kind, 'player');
  assert.equal(s.winner.id, 'B');
});

test('Q7②：铸剑为犁销毁对手唯一武器 → 对手被判负，且打出者不知是否命中', () => {
  const s = scenario({ A: ['f4', 'p1', 'p3'], B: ['i1'], deck: [] });
  playFunction(s, s.turn, { cardId: 'f4' });
  assert.equal(s.players.B.hand.length, 0);
  assert.equal(s.winner.id, 'A');
  assert.ok(s.discard.includes('i1'));
  const publicTexts = s.events.filter((e) => e.scope === 'all').map((e) => e.text).join('|');
  assert.equal(publicTexts.includes('i1'), false, '公开信息不含武器 id');
  assert.equal(viewFor(s, 'A').privateLog.some((l) => l.includes('销毁')), false, '只提示结算完成');
});

test('Q7③：不出战被夺走最后一张手牌 → 立刻判负', () => {
  const s = scenario({ A: ['p1', 'p3', 'i1'], B: ['p7'], deck: [] });
  passFunction(s);
  apply(s, { type: 'DECLARE', playerId: 'A', fight: true, personCardId: 'p1' });
  apply(s, { type: 'DECLARE', playerId: 'B', fight: false });
  assert.equal(s.players.B.hand.length, 0);
  assert.equal(s.winner.id, 'A');
});

test('功能牌不可转移：不出战惩罚不会夺走功能牌（Q6）', () => {
  const s = scenario({ A: ['f2', 'f3'], B: ['f1'], deck: [] });
  passFunction(s);
  apply(s, { type: 'DECLARE', playerId: 'A', fight: false });
  apply(s, { type: 'DECLARE', playerId: 'B', fight: false });
  assert.deepEqual([...s.players.A.hand].sort(), ['f2', 'f3']);
  assert.deepEqual([...s.players.B.hand], ['f1'], '手牌只剩功能牌时无法被夺取');
  assert.equal(s.events.filter((e) => e.type === 'penalty-none').length, 2);
  assert.equal(s.winner, null);
});

test('推心置腹：交换成功双方可见，皇冠溢出弃置（Q6/Q10）', () => {
  const s = scenario({ A: ['f5', 'i7', 'p1'], B: ['i8'], deck: [] });
  playFunction(s, s.turn, { cardId: 'f5', giveCardId: 'p1' });
  assert.deepEqual([...s.players.A.hand], ['i7']);
  assert.deepEqual([...s.players.B.hand], ['p1']);
  assert.ok(s.discard.includes('i8'), 'A 已有皇冠 → 收到的皇冠溢出弃置');
  const swap = s.events.find((e) => e.type === 'swap');
  assert.equal(swap.scope, 'all', '交换的卡牌双方可见');
  assert.ok(swap.text.includes('溢'));
});

test('推心置腹：不能拿功能牌去交换（Q6）', () => {
  const s = scenario({ A: ['f5', 'f6', 'p1', 'p3'], B: ['p7', 'i1'], deck: [] });
  playFunction(s, s.turn, { cardId: 'f5', giveCardId: 'f6' });
  assert.ok(s.players.A.hand.includes('f6'), '功能牌仍在手中，交换未发生');
  assert.deepEqual([...s.players.B.hand].sort(), ['i1', 'p7']);
});

test('颠倒是非：随机翻面一张人牌', () => {
  const s = scenario({ A: ['f3', 'p1', 'p3'], B: ['p7'], deck: [] });
  assert.equal(s.cards['p7'].align, '恶');
  playFunction(s, s.turn, { cardId: 'f3' });
  assert.equal(s.cards['p7'].align, '善', '人(恶) 被翻面为 人(善)');
  assert.equal(s.events.some((e) => e.type === 'complete'), true, '只提示结算完成');
  const publicTexts = s.events.filter((e) => e.scope === 'all').map((e) => e.text).join('|');
  assert.equal(publicTexts.includes('人(善)'), false, '公开日志不泄露是否翻转成功');
});

test('重整：从剩余牌堆随机抽取一张人牌，牌堆其余卡牌不动', () => {
  const s = scenario({ A: ['f2', 'p1', 'p3'], B: ['p7', 'p8'], deck: ['i1', 'p5', 'i2'] });
  playFunction(s, s.turn, { cardId: 'f2' });
  assert.ok(s.players.A.hand.includes('p5'));
  assert.deepEqual([...s.deck], ['i1', 'i2'], '非人牌保持原顺序');
  const log = s.events.find((e) => e.type === 'regroup');
  assert.equal(log.scope, 'private');
  assert.equal(viewFor(s, 'B').privateLog.length, 0);
});

test('重整：牌堆已无人牌则无效果', () => {
  const s = scenario({ A: ['f2', 'p1', 'p3'], B: ['p7', 'p8'], deck: ['i1'] });
  playFunction(s, s.turn, { cardId: 'f2' });
  assert.deepEqual([...s.deck], ['i1']);
  assert.equal(s.players.A.hand.length, 2);
});

test('止戈：跳过全部后续阶段，计数 +1；下一位未打止戈则清零（Q5）', () => {
  // 牌堆故意留 1 张：牌堆见底时打出止戈会立刻结算，这里要测的是阶段跳过与计数
  const s = scenario({ A: ['f7', 'p1', 'p3'], B: ['p7', 'p8'], deck: ['i1'] });
  playFunction(s, s.turn, { cardId: 'f7' });
  assert.equal(s.atWarCounter, 1);
  assert.equal(s.turn, 'B', '直接进入回合结束并换手');
  assert.deepEqual(s.pending.submitted, []);

  passFunction(s);
  apply(s, { type: 'DECLARE', playerId: 'B', fight: false });
  apply(s, { type: 'DECLARE', playerId: 'A', fight: false });
  assert.equal(s.atWarCounter, 0, 'B 未打出止戈 → 计数清零');
});

test('标准牌组：止戈全局仅 1 张（f7），张数与终局阈值必须自洽', () => {
  const state = createState(11);
  dealInitial(state);
  const zhiGe = Object.values(state.cards).filter((c) => c.name === '止戈');
  assert.equal(zhiGe.length, 1, '止戈 ×1');
  assert.equal(zhiGe[0].id, 'f7');
  assert.equal(RULES.zhiGeCopies, 1);
  assert.equal(RULES.zhiGeGoal, 1, '只有 1 张止戈 → 阈值只能是 1，否则终局条款是死条款');
});

test('止戈终局：主牌堆已空时打出止戈 → 立即停战，按手牌数结算', () => {
  const s = scenario({ A: ['f7', 'p1', 'p2'], B: ['p7', 'p8'], deck: [] });
  playFunction(s, s.turn, { cardId: 'f7' });
  assert.equal(s.atWarCounter, 1);
  assert.ok(s.winner, '牌堆见底 + 止戈生效 → 立刻结算');
  assert.ok(s.winner.reason.includes('止戈'));
  assert.equal(s.winner.kind, 'draw', '手牌 A=2 / B=2 → 平局');
});

test('止戈终局：手牌多者可借此赢棋（牌堆见底时打出止戈）', () => {
  const s = scenario({ A: ['f7', 'p1', 'p2', 'p3'], B: ['p7', 'p8'], deck: [] });
  playFunction(s, s.turn, { cardId: 'f7' });
  assert.equal(s.winner.id, 'A', 'A 手牌 3 : 2 → A 胜');
  assert.ok(s.winner.reason.includes('止戈'));
});

test('止戈终局：牌堆未空时不结算，且下一回合没再打止戈则计数清零', () => {
  const s = scenario({ A: ['f7', 'p1', 'p2'], B: ['p7', 'p8'], deck: ['i1', 'i2'] });
  playFunction(s, s.turn, { cardId: 'f7' });
  assert.equal(s.atWarCounter, 1);
  assert.equal(s.winner, null, '主牌堆还有牌 → 不结算');
  assert.equal(s.turn, 'B', '止戈直接跳过宣告与战斗，回合交给 B');
  passFunction(s);
  apply(s, { type: 'DECLARE', playerId: 'A', fight: true, personCardId: 'p1' });
  apply(s, { type: 'DECLARE', playerId: 'B', fight: true, personCardId: 'p7' });
  assert.equal(s.atWarCounter, 0, 'B 没打止戈 → 回合结束计数清零');
  assert.equal(s.winner, null);
});

test('止戈终局不误触发：主牌堆为空但本回合无人打止戈 → 继续对局', () => {
  const s = scenario({ A: ['p1', 'p3'], B: ['p7', 'p8'], deck: [] });
  passFunction(s);
  apply(s, { type: 'DECLARE', playerId: 'A', fight: false });
  apply(s, { type: 'DECLARE', playerId: 'B', fight: false });
  assert.equal(s.atWarCounter, 0);
  assert.equal(s.winner, null, '没有止戈 → 不触发止戈终局');
});

// 平局改为双方弃牌后，同一张牌只能打一次，所以这些用例要按回合准备牌。
// 双方各 6 张人牌 + 1 张从不参战的道具（保证手牌不会归零，从而走到僵局/回合上限分支）。
const DRAW_LINEUP = {
  A: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'i1'],
  B: ['p7', 'p8', 'p9', 'p10', 'p11', 'p12', 'i2'],
};
// 6 次对战 = 3 个完整回合（每次双方都单人出战 → 双普通人 → 平局）
const DRAW_MATCHUPS = [['p1', 'p7'], ['p2', 'p8'], ['p3', 'p9'], ['p4', 'p10'], ['p5', 'p11'], ['p6', 'p12']];

function playAllDraws(s) {
  for (const [a, b] of DRAW_MATCHUPS) {
    if (s.winner) break;
    passFunction(s);
    apply(s, { type: 'DECLARE', playerId: 'A', fight: true, personCardId: a });
    apply(s, { type: 'DECLARE', playerId: 'B', fight: true, personCardId: b });
  }
}

test('僵局兜底：主牌堆耗尽后连续 3 个完整回合无战斗胜负 → 按手牌数结算（Q9）', () => {
  const s = scenario({ ...DRAW_LINEUP, deck: [] });
  playAllDraws(s);
  assert.ok(s.winner, '必须结束，不能无限平局循环');
  assert.ok(s.winner.reason.includes('连续'));
  assert.equal(s.winner.kind, 'draw', '双方手牌数相同 → 平局');
});

test('全局回合上限：达到上限按手牌数结算', () => {
  withRules({ maxRounds: 3, stalemateRounds: 99 }, () => {
    const s = scenario({ ...DRAW_LINEUP, deck: [] });
    playAllDraws(s);
    assert.ok(s.winner);
    assert.ok(s.winner.reason.includes('回合上限'));
  });
});

test('皇冠上限：任何获得路径都不可让手牌出现 2 张皇冠', () => {
  const s = scenario({ A: ['i7'], B: ['p1'], deck: [] });
  const res = acquire(s, 'A', 'i8');
  assert.equal(res.overflow, true);
  assert.equal(res.placed, 'discard');
  assert.equal(s.players.A.hand.filter((id) => s.cards[id].name === '皇冠').length, 1);
  assert.ok(s.discard.includes('i8'));
});
test('止戈两个旋钮：zhiGeCopies 控制张数（改成 2 → 29 张变体牌组），zhiGeGoal 控制终局阈值', () => {
  assert.equal(RULES.zhiGeCopies, 1, '标准牌组：止戈 1 张');
  assert.equal(RULES.zhiGeGoal, 1, '标准规则：阈值 1');
  withRules({ zhiGeCopies: 2 }, () => {
    const s = scenario({ A: ['f7', 'p1', 'p3'], B: ['f8', 'p7', 'p8'], deck: [] });
    assert.equal(Object.values(s.cards).filter((c) => c.name === '止戈').length, 2);
    assert.equal(Object.keys(s.cards).length, 29, '止戈 ×2 → 牌组 29 张（变体）');
    playFunction(s, s.turn, { cardId: 'f7' });
    assert.ok(s.winner, '阈值 1 下，第一张止戈（牌堆已空）即可触发终局');
    assert.ok(s.winner.reason.includes('止戈'));
  });
});
test('贼效果·对手出战组合无武器：事件仍带 data.side（界面提示不得因缺字段崩溃）', () => {
  const s = scenario({ A: ['p1', 'i9'], B: ['p7'], deck: [] });   // i9 = 隐身衣
  passFunction(s);
  apply(s, { type: 'DECLARE', playerId: 'A', fight: true, personCardId: 'p1', itemCardId: 'i9' });
  apply(s, { type: 'DECLARE', playerId: 'B', fight: true, personCardId: 'p7' });

  const cloak = s.events.filter((e) => e.type === 'thief-cloak');
  const steal = s.events.filter((e) => e.type === 'thief-steal');
  assert.equal(cloak.length, 1, '贼效果应先弃隐身衣');
  assert.equal(steal.length, 1, '贼效果应产生一次夺取结算');
  assert.ok(steal[0].data && steal[0].data.side, 'thief-steal 必须带 data.side：web/app.js 的提示直接读它');
  assert.equal(steal[0].data.stolen, false, '对手出战组合无武器 → stolen=false');
  assert.ok(s.discard.includes('i9'), '隐身衣进弃牌堆');
  const reveal = s.events.find((e) => e.type === 'battle-reveal');
  assert.equal(reveal.data.A.identity, '贼', '身份在锁定瞬间冻结（Q2）');
  assert.ok(s.events.some((e) => e.type === 'battle-draw'), '贼对国王 → 平局（Q2）');
});

test('事件字段齐备：界面读取的每种事件都带必要载荷', () => {
  const needs = {
    'thief-steal': (e) => e.data && e.data.side,
    'thief-cloak': (e) => e.data && e.data.side,
    'crown-overflow': (e) => e.text || (e.data && e.data.player),
    'battle-reveal': (e) => e.data && e.data.A && e.data.B,
  };
  for (let seed = 1; seed <= 40; seed++) {
    const s = scenario({ seed, A: ['i9', 'p1', 'p2'], B: ['i8', 'p3', 'p4'], deck: ['p5', 'p6', 'f1'], startPhase: 'function' });
    passFunction(s);
    apply(s, { type: 'DECLARE', playerId: 'A', fight: true, personCardId: 'p1', itemCardId: 'i9' });
    apply(s, { type: 'DECLARE', playerId: 'B', fight: true, personCardId: 'p3', itemCardId: 'i8' });
    for (const e of s.events) {
      if (!needs[e.type]) continue;
      assert.ok(needs[e.type](e), `种子 ${seed} 的 ${e.type} 事件缺少界面需要的字段`);
    }
  }
});
test('事件字段齐备（续）：牌桌动画依赖的 penalty / zhige / swap 载荷', () => {
  // 不出战惩罚：A 出战、B 不出战 → penalty 必须带 passer/taker（web/app.js 用它把牌从谁飞给谁）
  const s1 = scenario({ A: ['p1', 'p2'], B: ['p3', 'p4'], deck: [] });
  passFunction(s1);
  apply(s1, { type: 'DECLARE', playerId: 'A', fight: true, personCardId: 'p1' });
  apply(s1, { type: 'DECLARE', playerId: 'B', fight: false });
  const pen = s1.events.find((e) => e.type === 'penalty');
  assert.ok(pen && pen.data, 'penalty 应带 data');
  assert.equal(pen.data.passer, 'B', 'penalty.data.passer 应为不出战方');
  assert.equal(pen.data.taker, 'A', 'penalty.data.taker 应为夺牌方');

  // 止戈：data.player 用于两端把横幅写成「X 打出止戈」
  const s2 = scenario({ A: ['f7', 'p1', 'p2'], B: ['p3', 'p4'], deck: [] });
  playFunction(s2, s2.turn, { cardId: 'f7' });
  const zg = s2.events.find((e) => e.type === 'zhige');
  assert.ok(zg && zg.data, 'zhige 应带 data');
  assert.equal(zg.data.player, 'A');

  // 推心置腹：swap 的 player/giveId/takeId 用于双向飞牌
  const s3 = scenario({ A: ['f5', 'p1', 'p2'], B: ['p3', 'p4'], deck: [] });
  playFunction(s3, s3.turn, { cardId: 'f5', giveCardId: 'p1' });
  const sw = s3.events.find((e) => e.type === 'swap');
  assert.ok(sw && sw.data, 'swap 应带 data');
  assert.equal(sw.data.player, 'A');
  assert.equal(sw.data.giveId, 'p1');
  assert.ok(sw.data.takeId, 'swap.data.takeId 应存在');
  assert.notEqual(sw.data.takeId, 'p1');
});