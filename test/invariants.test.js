import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, createState } from '../src/engine.js';
import { RULES } from '../src/rules.js';
import { autoplay } from '../src/bot.js';

const TOTAL = Object.keys(createState(1).cards).length; // 29：止戈 ×2

function allZoneCards(s) {
  return [
    ...s.deck.map((id) => ['deck', id]),
    ...s.players.A.hand.map((id) => ['A.hand', id]),
    ...s.players.B.hand.map((id) => ['B.hand', id]),
    ...s.discard.map((id) => ['discard', id]),
    ...s.battleZone.A.map((id) => ['A.battle', id]),
    ...s.battleZone.B.map((id) => ['B.battle', id]),
  ];
}

test('随机对局不变式：卡牌守恒 / 皇冠上限 / 功能牌唯一 / 必定终止', () => {
  const stats = {};
  for (let seed = 1; seed <= 400; seed++) {
    const s = createGame(seed);
    autoplay(s, seed);

    assert.ok(s.winner, `seed ${seed} 未在回合上限内结束`);
    const cards = allZoneCards(s);
    assert.equal(cards.length, TOTAL, `seed ${seed} 卡牌总数不是 ${TOTAL}`);
    const ids = cards.map(([, id]) => id);
    assert.equal(new Set(ids).size, TOTAL, `seed ${seed} 出现重复或丢失的卡牌`);

    for (const id of ['A', 'B']) {
      const crowns = s.players[id].hand.filter((c) => s.cards[c].name === '皇冠');
      assert.ok(crowns.length <= RULES.crownCap, `seed ${seed} ${id} 持有 ${crowns.length} 张皇冠`);
    }
    // 0 手牌只可能来自两条路径：单方手牌归零判负、双方同时归零判平局
    const zeroHands = ['A', 'B'].filter((id) => s.players[id].hand.length === 0);
    if (zeroHands.length > 0) {
      const ok = s.winner.reason.includes('手牌归零') || s.winner.reason.includes('同时归零');
      assert.ok(ok, `seed ${seed} 出现 0 手牌但终局原因不符：${s.winner.reason}`);
    }
    assert.equal(s.battleZone.A.length + s.battleZone.B.length, 0, '结束后不应残留出战卡牌');
    assert.ok(s.round <= RULES.maxRounds + 1, `seed ${seed} 回合数 ${s.round} 超上限`);
    assert.ok(s.pending === null || s.winner, '结束后不应有待处理指令');

    const fns = s.discard.filter((id) => s.cards[id].kind === 'function');
    assert.equal(new Set(fns).size, fns.length, `seed ${seed} 功能牌被重复结算`);

    const key = s.winner.reason.includes('止戈') ? '止戈'
      : s.winner.reason.includes('连续') ? '僵局兜底'
      : s.winner.reason.includes('回合上限') ? '回合上限'
      : s.winner.reason.includes('同时归零') ? '平局'
      : '手牌归零';
    stats[key] = (stats[key] ?? 0) + 1;
  }
  console.log('    结束原因分布:', JSON.stringify(stats, null, 0));
});

test('消极对局（双方几乎不出战）同样必然终止', () => {
  for (let seed = 100; seed <= 140; seed++) {
    const s = createGame(seed);
    autoplay(s, seed, { fightChance: 0 });
    assert.ok(s.winner, `seed ${seed} 消极对局未结束`);
  }
});

test('激进对局（双方总是出战）同样必然终止', () => {
  for (let seed = 200; seed <= 240; seed++) {
    const s = createGame(seed);
    autoplay(s, seed, { fightChance: 1 });
    assert.ok(s.winner, `seed ${seed} 激进对局未结束`);
  }
});
test('可复现性：同一种子两次运行的公开事件与终局完全一致', () => {
  const run = () => {
    const s = createGame(20260925);
    autoplay(s, 20260925);
    return s;
  };
  const a = run();
  const b = run();
  assert.deepEqual(a.events.map((e) => e.text), b.events.map((e) => e.text), '事件序列必须完全一致');
  assert.deepEqual(a.winner, b.winner);
  assert.equal(a.round, b.round);
  assert.deepEqual(a.players.A.hand, b.players.A.hand);
  assert.deepEqual(a.players.B.hand, b.players.B.hand);
});