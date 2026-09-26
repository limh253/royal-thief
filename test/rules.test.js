import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCards, label } from '../src/cards.js';
import { BEATS, IDENTITIES, RULES, compareIdentity, identityOf } from '../src/rules.js';
import { createState } from '../src/engine.js';

test('牌组构成：12 张人牌 + 9 张道具 + 7 张功能牌 = 28 张', () => {
  // 用 createState 而不是裸 buildCards()：牌组必须与 RULES 一致
  const cards = Object.values(createState(1).cards);
  assert.equal(cards.length, 28);
  const count = (pred) => cards.filter(pred).length;
  assert.equal(count((c) => c.kind === 'person'), 12);
  assert.equal(count((c) => c.kind === 'person' && c.align === '善'), 6);
  assert.equal(count((c) => c.kind === 'person' && c.align === '恶'), 6);
  assert.equal(count((c) => c.kind === 'item' && c.name === '武器'), 6);
  assert.equal(count((c) => c.kind === 'item' && c.name === '皇冠'), 2);
  assert.equal(count((c) => c.kind === 'item' && c.name === '隐身衣'), 1);
  assert.equal(count((c) => c.kind === 'function'), 7);
  // 每种功能牌全局仅 1 张
  for (const name of ['洞若观火', '重整', '颠倒是非', '铸剑为犁', '推心置腹', '沉默', '止戈']) {
    assert.equal(count((c) => c.kind === 'function' && c.name === name), 1, `${name} 应只有 1 张`);
  }
  assert.equal(count((c) => c.kind === 'function' && c.name === '止戈'), RULES.zhiGeCopies, '止戈张数由 RULES.zhiGeCopies 控制');
  assert.equal(RULES.zhiGeCopies, 1, '止戈全局只有 1 张');
  assert.equal(RULES.zhiGeGoal, 1, '只有 1 张止戈 → 终局阈值必须是 1，否则该条款是死条款');
  assert.equal(label({ kind: 'person', align: '恶' }), '人(恶)');
});

test('身份推导：含背水一战与道具组合', () => {
  const good = { kind: 'person', align: '善' };
  const evil = { kind: 'person', align: '恶' };
  const weapon = { kind: 'item', name: '武器' };
  const crown = { kind: 'item', name: '皇冠' };
  const cloak = { kind: 'item', name: '隐身衣' };

  assert.equal(identityOf({ person: good, item: null }, false), '普通人');
  assert.equal(identityOf({ person: evil, item: null }, false), '普通人');
  assert.equal(identityOf({ person: good, item: null }, true), '骑士');
  assert.equal(identityOf({ person: evil, item: null }, true), '匪徒');
  assert.equal(identityOf({ person: good, item: weapon }, false), '骑士');
  assert.equal(identityOf({ person: evil, item: weapon }, false), '匪徒');
  assert.equal(identityOf({ person: good, item: crown }, false), '国王');
  assert.equal(identityOf({ person: good, item: cloak }, false), '贼');
  assert.throws(() => identityOf({ person: null, item: weapon }, false), /必须包含人牌/);
});

test('克制表与平局判定', () => {
  assert.deepEqual(BEATS['骑士'], ['匪徒', '普通人']);
  assert.deepEqual(BEATS['匪徒'], ['国王', '普通人']);
  assert.deepEqual(BEATS['国王'], ['骑士']);
  assert.deepEqual(BEATS['普通人'], ['国王']);
  assert.deepEqual(BEATS['贼'], [], 'Q2 决议：贼无克制');

  assert.equal(compareIdentity('骑士', '匪徒'), 'a');
  assert.equal(compareIdentity('匪徒', '骑士'), 'b');
  assert.equal(compareIdentity('国王', '骑士'), 'a');
  assert.equal(compareIdentity('普通人', '国王'), 'a');
  assert.equal(compareIdentity('匪徒', '国王'), 'a');
  assert.equal(compareIdentity('骑士', '骑士'), 'draw');
  assert.equal(compareIdentity('国王', '国王'), 'draw');
  assert.equal(compareIdentity('普通人', '普通人'), 'draw');
  // 贼 vs 任意身份 = 平局
  for (const id of IDENTITIES) {
    assert.equal(compareIdentity('贼', id), 'draw', `贼 vs ${id}`);
    assert.equal(compareIdentity(id, '贼'), 'draw', `${id} vs 贼`);
  }
});

test('善恶在双人组合与背水一战中生效', () => {
  const good = { kind: 'person', align: '善' };
  const evil = { kind: 'person', align: '恶' };
  const weapon = { kind: 'item', name: '武器' };
  assert.equal(compareIdentity(identityOf({ person: good, item: weapon }, false), identityOf({ person: evil, item: weapon }, false)), 'a');
  assert.equal(identityOf({ person: good, item: null }, true), identityOf({ person: good, item: weapon }, false));
});