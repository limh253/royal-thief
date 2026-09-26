import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../src/engine.js';
import { viewFor } from '../src/view.js';
import { scenario, passFunction, playFunction } from './scenario.js';

// 卡牌 id 约定：p1..p6 = 人(善)，p7..p12 = 人(恶)，i1..i6 = 武器，i7..i8 = 皇冠，i9 = 隐身衣
// f1=洞若观火 f2=重整 f3=颠倒是非 f4=铸剑为犁 f5=推心置腹 f6=沉默 f7=止戈

test('同时宣告（commit-reveal）：双方都提交后才结算，先提交方内容不泄漏', () => {
  const s = scenario({ A: ['p1', 'i1', 'p3'], B: ['p7', 'i2', 'p8'], deck: [] });
  assert.equal(s.pending.kind, 'function-phase');
  passFunction(s);
  assert.equal(s.pending.kind, 'declare-phase');

  apply(s, { type: 'DECLARE', playerId: 'A', fight: true, personCardId: 'p1', itemCardId: 'i1' });
  assert.equal(s.pending.kind, 'declare-phase', '仅一方提交时不得结算');
  assert.equal(s.phase, 'declare');

  const viewB = viewFor(s, 'B');
  assert.equal(JSON.stringify(viewB.pending).includes('p1'), false, 'B 看不到 A 提交的出战卡牌');
  assert.equal(JSON.stringify(viewB.pending).includes('"i1"'), false);
  assert.equal(viewB.publicLog.some((l) => l.includes('人(善)')), false);

  apply(s, { type: 'DECLARE', playerId: 'B', fight: true, personCardId: 'p7', itemCardId: 'i2' });
  assert.equal(s.pending.kind, 'battle-reward');
  assert.equal(s.pending.winner, 'A', '人(善)+武器=骑士 克制 人(恶)+武器=匪徒');
});

test('胜者选择①保留：对手出战牌进弃牌堆；败者看不到胜者选项', () => {
  const s = scenario({ A: ['p1', 'i1', 'p3'], B: ['p7', 'i2', 'p8'], deck: [] });
  passFunction(s);
  apply(s, { type: 'DECLARE', playerId: 'A', fight: true, personCardId: 'p1', itemCardId: 'i1' });
  apply(s, { type: 'DECLARE', playerId: 'B', fight: true, personCardId: 'p7', itemCardId: 'i2' });
  apply(s, { type: 'CHOOSE_REWARD', playerId: 'A', option: 'keep' });

  assert.equal(s.winner, null);
  assert.deepEqual([...s.players.A.hand].sort(), ['i1', 'p1', 'p3']);
  assert.deepEqual([...s.players.B.hand], ['p8']);
  assert.ok(s.discard.includes('p7') && s.discard.includes('i2'));
  const viewB = viewFor(s, 'B');
  assert.equal(viewB.privateLog.some((l) => l.includes('你选择了')), false, '败者不可见胜者选项');
  assert.equal(viewB.privateLog.length, 0);
  assert.ok(viewFor(s, 'A').privateLog.some((l) => l.includes('你选择了')));
  assert.equal(s.turn, 'B');
  assert.equal(s.pending.kind, 'function-phase');
  assert.deepEqual(s.pending.submitted, []);
});

test('胜者选择②收入：弃掉自己的出战牌，对手皇冠因上限溢出弃置', () => {
  const s = scenario({ A: ['p1', 'i7', 'p3'], B: ['p7', 'i8', 'p8'], deck: [] });
  passFunction(s);
  apply(s, { type: 'DECLARE', playerId: 'A', fight: true, personCardId: 'p1' });       // 普通人（手中另有皇冠）
  apply(s, { type: 'DECLARE', playerId: 'B', fight: true, personCardId: 'p7', itemCardId: 'i8' }); // 国王
  assert.equal(s.pending.kind, 'battle-reward');
  assert.equal(s.pending.winner, 'A', '普通人 克制 国王');

  apply(s, { type: 'CHOOSE_REWARD', playerId: 'A', option: 'take' });
  assert.deepEqual([...s.players.A.hand].sort(), ['i7', 'p3', 'p7']);
  assert.ok(s.discard.includes('p1') && s.discard.includes('i8'), '自己的出战牌与溢出皇冠均进弃牌堆');
  const crowns = s.players.A.hand.filter((id) => s.cards[id].name === '皇冠');
  assert.equal(crowns.length, 1);
  assert.ok(s.events.some((e) => e.type === 'crown-overflow' && e.scope === 'all'), 'Q10：溢出提示双方可见');
});

test('单方出战：出战牌返还，不出战方被随机夺走 1 张（Q4）', () => {
  const s = scenario({ A: ['p1', 'i1', 'p3'], B: ['p7', 'i2', 'p8'], deck: [] });
  passFunction(s);
  apply(s, { type: 'DECLARE', playerId: 'A', fight: true, personCardId: 'p1' });
  apply(s, { type: 'DECLARE', playerId: 'B', fight: false });

  assert.equal(s.winner, null);
  assert.equal(s.players.A.hand.length, 4, 'A 出战牌返还 + 从 B 处夺得 1 张');
  assert.ok(s.players.A.hand.includes('p1'));
  assert.equal(s.players.B.hand.length, 2);
  const stolen = s.players.A.hand.filter((id) => ['p7', 'i2', 'p8'].includes(id));
  assert.equal(stolen.length, 1);
  assert.equal(s.turn, 'B');
});

test('双方都不出战：双向惩罚，手牌数量不变', () => {
  const s = scenario({ A: ['p1', 'i1', 'p3'], B: ['p7', 'i2', 'p8'], deck: [] });
  passFunction(s);
  apply(s, { type: 'DECLARE', playerId: 'A', fight: false });
  apply(s, { type: 'DECLARE', playerId: 'B', fight: false });
  assert.equal(s.winner, null);
  assert.equal(s.players.A.hand.length, 3);
  assert.equal(s.players.B.hand.length, 3);
  assert.equal(s.turn, 'B');
});

test('平局：双方出战卡牌全部进弃牌堆（骑士 vs 骑士）', () => {
  const s = scenario({ A: ['p1', 'i1', 'p3'], B: ['p2', 'i2', 'p4'], deck: [] });
  passFunction(s);
  apply(s, { type: 'DECLARE', playerId: 'A', fight: true, personCardId: 'p1', itemCardId: 'i1' });
  apply(s, { type: 'DECLARE', playerId: 'B', fight: true, personCardId: 'p2', itemCardId: 'i2' });
  assert.equal(s.winner, null);
  assert.deepEqual([...s.players.A.hand].sort(), ['p3'], '平局不再返还，A 只剩没出战的那张');
  assert.deepEqual([...s.players.B.hand].sort(), ['p4'], '平局不再返还，B 只剩没出战的那张');
  for (const id of ['p1', 'i1', 'p2', 'i2']) assert.ok(s.discard.includes(id), `${id} 应进弃牌堆`);
  assert.equal(s.battleZone.A.length, 0);
  assert.equal(s.battleZone.B.length, 0);
  assert.ok(s.events.find((e) => e.type === 'battle-draw').text.includes('弃牌堆'), '公开信息应说明平局弃牌');
});

test('平局弃牌导致双方手牌同时归零 → 平局（Q7 补充）', () => {
  const s = scenario({ A: ['p1'], B: ['p3'], deck: [] });
  passFunction(s);
  assert.equal(s.berserk.A, true, '仅 1 张人牌 → 背水一战成立');
  apply(s, { type: 'DECLARE', playerId: 'A', fight: true, personCardId: 'p1' });
  apply(s, { type: 'DECLARE', playerId: 'B', fight: true, personCardId: 'p3' });
  assert.equal(s.players.A.hand.length, 0);
  assert.equal(s.players.B.hand.length, 0);
  assert.equal(s.winner.kind, 'draw');
  assert.ok(s.winner.reason.includes('同时归零'));
});

test('平局弃牌导致单方手牌归零 → 该方判负', () => {
  // A 只有 1 张人牌 → 背水一战 → 骑士；B 用人(善)+武器 → 同为骑士 → 平局
  const s = scenario({ A: ['p1'], B: ['p3', 'i1', 'p4'], deck: [] });
  passFunction(s);
  assert.equal(s.berserk.A, true);
  apply(s, { type: 'DECLARE', playerId: 'A', fight: true, personCardId: 'p1' });
  apply(s, { type: 'DECLARE', playerId: 'B', fight: true, personCardId: 'p3', itemCardId: 'i1' });
  assert.equal(s.players.A.hand.length, 0, 'A 的出战牌被弃置');
  assert.equal(s.players.B.hand.length, 1, 'B 还剩 1 张没参战的牌');
  assert.equal(s.winner.id, 'B', 'A 出战牌被弃后手牌归零 → 判负');
  assert.ok(s.winner.reason.includes('A 手牌归零'));
});

test('平局弃牌不会把功能牌带走（出战组合本就不含功能牌）', () => {
  const s = scenario({ A: ['p1', 'f1'], B: ['p3', 'f2'], deck: [] });
  passFunction(s);
  apply(s, { type: 'DECLARE', playerId: 'A', fight: true, personCardId: 'p1' });
  apply(s, { type: 'DECLARE', playerId: 'B', fight: true, personCardId: 'p3' });
  assert.deepEqual([...s.players.A.hand], ['f1']);
  assert.deepEqual([...s.players.B.hand], ['f2']);
});

test('贼：身份冻结为贼（弃隐身衣），夺取对手武器，结果平局（Q2）', () => {
  const s = scenario({ A: ['p1', 'i9', 'p3'], B: ['p7', 'i1', 'p8'], deck: [] });
  passFunction(s);
  apply(s, { type: 'DECLARE', playerId: 'A', fight: true, personCardId: 'p1', itemCardId: 'i9' });
  apply(s, { type: 'DECLARE', playerId: 'B', fight: true, personCardId: 'p7', itemCardId: 'i1' });

  assert.equal(s.winner, null);
  assert.ok(s.discard.includes('i9'), '隐身衣被弃');
  assert.ok(s.players.A.hand.includes('i1'), '武器被贼夺走');
  assert.equal(s.players.A.hand.includes('i9'), false);
  assert.deepEqual([...s.players.B.hand].sort(), ['p8'], '平局 → B 的出战牌 p7 进弃牌堆');
  assert.ok(s.discard.includes('p7'), '平局弃牌：A 的 p1 与 B 的 p7 都进弃牌堆');
  assert.ok(s.discard.includes('p1'));
  assert.ok(s.events.find((e) => e.type === 'battle-reveal').text.includes('隐身衣'));
  assert.ok(s.events.some((e) => e.type === 'battle-draw' && e.text.includes('贼')), '贼无克制 → 平局');
  assert.equal(s.pending.kind, 'function-phase');
  assert.deepEqual(s.pending.submitted, []);
});

test('洞若观火：结果只给探查者，公开信息不泄漏', () => {
  const s = scenario({ A: ['f1', 'p1', 'p3'], B: ['p7', 'p8'], deck: [] });
  playFunction(s, s.turn, { cardId: 'f1' });
  assert.equal(s.players.A.seenThisTurn.length, 1);
  const seen = s.players.A.seenThisTurn[0];
  assert.ok(['p7', 'p8'].includes(seen));

  const viewA = viewFor(s, 'A');
  const viewB = viewFor(s, 'B');
  assert.equal(viewA.yourSeenThisTurn[0].id, seen, '本回合可回看');
  assert.ok(viewA.privateLog.some((l) => l.includes('探查到')));
  assert.equal(viewB.privateLog.length, 0, '对手没有任何探查提示');
  assert.equal(viewB.publicLog.some((l) => l.includes(seen)), false);
  assert.equal(s.events.filter((e) => e.type === 'peek').length, 1);
  assert.equal(s.events.find((e) => e.type === 'peek').scope, 'private');
  assert.ok(s.events.some((e) => e.type === 'complete' && e.scope === 'all'), '公开只提示结算完成');
});

test('沉默：对手下一回合功能牌阶段被跳过，标记随即清除', () => {
  const s = scenario({ A: ['f6', 'p1', 'p3'], B: ['p7', 'p8'], deck: [] });
  playFunction(s, s.turn, { cardId: 'f6' });
  assert.equal(s.players.B.silenced, true);
  apply(s, { type: 'DECLARE', playerId: 'A', fight: false });
  apply(s, { type: 'DECLARE', playerId: 'B', fight: false });
  assert.equal(s.turn, 'B');
  assert.equal(s.pending.kind, 'function-phase', 'B 被沉默自动跳过；能力牌阶段是双方同时，A 还要提交');
  assert.deepEqual(s.pending.submitted, ['B'], 'B 已被自动记为已提交');
  assert.equal(s.players.B.silenced, false, '标记已清除');
  assert.ok(s.events.some((e) => e.type === 'silenced'));
  apply(s, { type: 'PASS_FUNCTION', playerId: 'A' });
  assert.equal(s.pending.kind, 'declare-phase', '双方都提交后进入宣告阶段');
});