import test from 'node:test';
import assert from 'node:assert/strict';
import { createHub, canAct } from '../src/room.js';
import { redactState, visibleEventsFor } from '../src/redact.js';
import { createGame } from '../src/engine.js';
import { makeBot } from '../src/bot.js';

test('房间：创建 / 加入 / 邀请码不区分大小写 / 满员', () => {
  const hub = createHub();
  const a = hub.create();
  assert.match(a.code, /^[A-Z2-9]{4}$/, '邀请码只含不易看错的字符');
  assert.equal(a.seat, 'A');
  assert.ok(a.token.length >= 16, '令牌要够长，避免被猜到');

  assert.equal(hub.join('ZZZZ').error, 'room-not-found');
  const b = hub.join(a.code.toLowerCase());
  assert.equal(b.seat, 'B');
  assert.equal(hub.join(a.code).error, 'room-full');
});

test('房间：令牌校验、不能替对手提交、不是你的回合会被挡住', () => {
  const hub = createHub();
  const a = hub.create();
  const b = hub.join(a.code);
  assert.equal(hub.auth(a.code, 'deadbeef'), null);
  const auth = hub.auth(a.code, b.token);
  assert.equal(auth.seat, 'B');

  const { room } = hub.auth(a.code, a.token);
  // 开局停在能力牌阶段：双方同时暗置，两边都能提交
  assert.equal(canAct(room.state, 'A'), true);
  assert.equal(canAct(room.state, 'B'), true, '能力牌阶段双方同时，B 也能提交');
  assert.equal(hub.act(room, 'A', { type: 'PASS_FUNCTION', playerId: 'B' }).error, 'not-your-seat');
  assert.ok(hub.act(room, 'A', { type: 'PASS_FUNCTION' }).ok);
  assert.equal(canAct(room.state, 'A'), false, '同一个人不能提交两次');
  assert.equal(hub.act(room, 'A', { type: 'PASS_FUNCTION' }).error, 'not-your-turn');
  assert.ok(hub.act(room, 'B', { type: 'PASS_FUNCTION' }).ok);
});

test('房间：快照只给该座位该看的信息（对手手牌 / 牌堆 / 种子都不下发）', () => {
  const hub = createHub();
  const a = hub.create();
  hub.join(a.code);
  const { room } = hub.auth(a.code, a.token);
  const snapA = hub.snapshot(room, 'A');
  const snapB = hub.snapshot(room, 'B');

  assert.equal(snapA.state.players.B.hand.every((id) => id.startsWith('__hidden')), true, '对手手牌只能是占位');
  assert.equal(snapA.state.deck.every((id) => id.startsWith('__hidden')), true, '牌堆顺序不能下发');
  assert.equal(room.state.players.B.hand.length > 0, true, '（前提）B 手里确实有牌');
  assert.equal(snapA.state.players.B.hand.length, 3, '对手手牌固定发 3 张占位：真实张数也是信息，不下发');
  assert.equal(snapA.state.berserk.B, false, '对手的背水一战属于私有信息');

  // cards 是公开的静态牌面目录（28 张的定义），扫泄漏时先把它挖空
  const raw = JSON.stringify({ ...snapA, state: { ...snapA.state, cards: {} } });
  for (const id of room.state.players.B.hand) assert.equal(raw.includes(`"${id}"`), false, `对手手牌 ${id} 不该出现在快照里`);
  for (const id of room.state.deck) assert.equal(raw.includes(`"${id}"`), false, `牌堆顶 ${id} 不该出现在快照里`);
  assert.equal(raw.includes(String(room.state.seed)), false, '种子能反推整副牌序，不能下发');
  assert.equal(/种子/.test(raw), false, '开局事件里的种子也要抹掉');
  assert.equal('rngState' in snapA.state, false);

  assert.equal(snapA.view.yourHand.length, room.state.players.A.hand.length);
  assert.equal(snapB.view.yourHand.length, room.state.players.B.hand.length);
  assert.equal(snapA.view.opponentHandCount, null, '默认不公开对手手牌数');
});

test('房间：联机是双方同时暗置，两个座位可以各自提交一次', () => {
  const hub = createHub();
  const a = hub.create();
  hub.join(a.code);
  const { room } = hub.auth(a.code, a.token);
  hub.act(room, 'A', { type: 'PASS_FUNCTION' });
  assert.equal(room.state.pending.kind, 'function-phase', '还等 B 提交能力牌');
  hub.act(room, 'B', { type: 'PASS_FUNCTION' });
  assert.equal(room.state.pending.kind, 'declare-phase');
  assert.equal(canAct(room.state, 'A'), true);
  assert.equal(canAct(room.state, 'B'), true, 'B 不需要等 A 提交完');
  assert.ok(hub.act(room, 'A', { type: 'DECLARE', fight: false }).ok);
  assert.equal(canAct(room.state, 'A'), false, '同一个人不能提交两次');
  assert.equal(canAct(room.state, 'B'), true);
  assert.ok(hub.act(room, 'B', { type: 'DECLARE', fight: false }).ok);
});

test('房间：rematch 换新局，并把各自那份快照推给两边', () => {
  const hub = createHub();
  const a = hub.create();
  hub.join(a.code);
  const { room } = hub.auth(a.code, a.token);
  const gotA = [];
  const gotB = [];
  hub.on(a.code, 'A', (s) => gotA.push(s));
  hub.on(a.code, 'B', (s) => gotB.push(s));
  const oldGame = room.gameId;
  hub.rematch(room);
  hub.publish(room);
  assert.equal(gotA.length, 1);
  assert.equal(gotB.length, 1);
  assert.notEqual(room.gameId, oldGame);
  assert.equal(gotA[0].you, 'A');
  assert.equal(gotB[0].you, 'B');
  assert.equal(gotA[0].seq, room.state.seq);
});

test('房间：用机器人走完一整局，全程不泄漏对手手牌', () => {
  const hub = createHub();
  const a = hub.create();
  hub.join(a.code);
  const { room } = hub.auth(a.code, a.token);
  const bot = makeBot(11, { fightChance: 0.65 });
  let guard = 0;
  while (!room.state.winner && guard++ < 900) {
    const st = room.state;
    const p = st.pending;
    if (!p) break;
    if (p.kind === 'function-phase') {
      for (const seat of ['A', 'B']) if (canAct(st, seat)) hub.act(room, seat, bot.next(st, seat));
    } else if (p.kind === 'declare-phase') {
      for (const seat of ['A', 'B']) if (canAct(st, seat)) hub.act(room, seat, bot.next(st, seat));
    } else if (p.kind === 'battle-reward') {
      hub.act(room, p.winner, { type: 'CHOOSE_REWARD', option: 'keep' });
    } else {
      break;
    }
    if (room.state.winner) break;
    for (const seat of ['A', 'B']) {
      const foe = seat === 'A' ? 'B' : 'A';
      const snap = hub.snapshot(room, seat);
      assert.equal(snap.state.players[foe].hand.every((id) => id.startsWith('__hidden')), true,
        `第 ${guard} 步后 ${seat} 的快照里出现了对手手牌`);
    }
  }
  assert.ok(room.state.winner, '一整局应当能正常结束');
  assert.ok(guard < 900, '不该卡住');
});

test('脱敏：私有事件只发给本人', () => {
  const s = createGame(3);
  s.events.push({ seq: 999, type: 'peek', scope: 'private', player: 'A', text: 'A 看到一张牌', data: { seenId: 'p1' } });
  s.events.push({ seq: 1000, type: 'peek', scope: 'private', player: 'B', text: 'B 看到一张牌', data: { seenId: 'p2' } });
  s.seq = 1000;
  assert.equal(visibleEventsFor(s, 'A').some((e) => e.seq === 1000), false);
  assert.equal(visibleEventsFor(s, 'B').some((e) => e.seq === 999), false);
  assert.equal(visibleEventsFor(s, 'A').some((e) => e.seq === 999), true);
  assert.equal(redactState(s, 'A').events.some((e) => e.seq === 1000), false);
});

test('房间：某个通道写崩了不能连累另一家（坏通道会被踢掉）', () => {
  const hub = createHub();
  const a = hub.create();
  hub.join(a.code);
  const { room } = hub.auth(a.code, a.token);

  const gotB = [];
  const gotA = [];
  hub.on(a.code, 'A', () => { throw new Error('dead socket'); });
  hub.on(a.code, 'A', (s) => gotA.push(s));
  hub.on(a.code, 'B', (s) => gotB.push(s));

  hub.publish(room);
  assert.equal(gotB.length, 1, 'A 这边写崩了，B 也要拿到推送');
  assert.equal(gotA.length, 1, '坏通道后面的好通道照样收到');
  hub.publish(room);
  assert.equal(gotB.length, 2);
  assert.equal(gotA.length, 2, '坏通道已被剔除，不再报错');
});
