import test from 'node:test';
import assert from 'node:assert/strict';
import { createRelayHostSession, createRelayGuestSession } from '../web/relay.js';

// 这组测试锁死「免后端联机」的协议：房主浏览器跑权威引擎，客机只发指令、收自己那份脱敏快照。
// 用一条内存里的假中继代替公共 MQTT，所以离线也能跑，还能精确检查「客机看不到房主手牌」。
function inMemoryRelay() {
  const hosts = { host: null, guest: null };
  const deliver = (target, topic, obj) => {
    const fn = hosts[target];
    if (fn) setTimeout(() => fn(topic, obj), 0);
  };
  const room = 'TEST';
  return {
    hostLink: {
      send(channel, obj) {
        const topic = `royal-thief/v1/${room}/${channel}`;
        deliver('guest', topic, obj);
      },
      close() { hosts.guest = null; },
    },
    guestLink: {
      send(channel, obj) {
        const topic = `royal-thief/v1/${room}/${channel}`;
        deliver('host', topic, obj);
      },
      close() { hosts.host = null; },
    },
    onHost(fn) { hosts.host = fn; },
    onGuest(fn) { hosts.guest = fn; },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pair() {
  const wire = inMemoryRelay();
  const seen = { host: [], guest: [] };
  const host = createRelayHostSession({
    onSnapshot: (snap) => seen.host.push(snap),
    onStatus: () => {},
    openLink: async ({ onMessage }) => { wire.onHost(onMessage); return wire.hostLink; },
  });
  const guest = createRelayGuestSession({
    code: host.code,
    onSnapshot: (snap) => seen.guest.push(snap),
    onStatus: () => {},
    openLink: async ({ onMessage }) => { wire.onGuest(onMessage); return wire.guestLink; },
  });
  host.connect();
  guest.connect();
  // 等到「双方就座」的那一帧：客机可能在房主刚接上中继时就收到一帧（那时 B 还没入座）
  const bothSeated = () => seen.guest.some((s) => s?.seats?.A && s?.seats?.B);
  for (let i = 0; i < 120 && !bothSeated(); i++) await sleep(10);
  return { host, guest, seen, wire };
}

test('中继联机：房主得码、客机用码进来，两边都拿到自己的快照', async () => {
  const { host, guest, seen } = await pair();
  assert.match(host.code, /^[A-Z0-9]{4}$/, '房主拿到 4 位邀请码');
  assert.equal(host.seat, 'A');
  assert.equal(guest.seat, 'B', '客机坐 B 位');
  assert.ok(seen.host.length > 0, '房主拿到自己的快照');
  assert.ok(seen.guest.length > 0, '客机拿到自己的快照');
  const g = seen.guest.at(-1);
  assert.equal(g.you, 'B');
  assert.equal(g.seats.A && g.seats.B, true, '两边都就座');
  assert.ok(g.state.players.B.hand.length >= 4, '客机看得到自己手牌');
});

test('中继联机：客机看不到房主的手牌与牌堆，只能看到背面占位', async () => {
  const { seen, host } = await pair();
  const g = seen.guest.at(-1);
  const realHand = host.state.players.A.hand;
  for (const id of realHand) {
    assert.ok(!g.state.players.A.hand.includes(id), '房主的手牌 id 不能下发');
  }
  assert.ok(g.state.players.A.hand.every((id) => id.startsWith('__hidden')), '对手手牌只给背面占位');
  assert.ok(g.state.deck.every((id) => id.startsWith('__hidden')), '牌堆也只给占位');
  assert.equal(g.state.players.B.seenThisTurn.length, 0);
});

test('中继联机：客机的指令由房主执行，两边快照同步往前走', async () => {
  const { host, guest, seen } = await pair();
  const seq0 = guest.state.seq;
  // 客机在自己的功能牌阶段打一张功能牌；房主同时也提交一次
  host.act('A', { type: 'PASS_FUNCTION' });
  guest.act('B', { type: 'PASS_FUNCTION' });
  for (let i = 0; i < 60; i++) {
    await sleep(10);
    if (guest.state.seq > seq0 && host.state.seq === guest.state.seq) break;
  }
  assert.ok(guest.state.seq > seq0, '客机的快照被房主推着往前走了');
  assert.equal(host.state.seq, guest.state.seq, '两边看到的牌局进度一致');
  assert.ok(seen.guest.length > 1, '客机收到不止一帧');
});

test('中继联机：房主重开一局，客机跟着换到新的一局', async () => {
  const { host, guest } = await pair();
  const oldGame = guest.gameId;
  host.rematch();
  for (let i = 0; i < 60 && guest.gameId === oldGame; i++) await sleep(10);
  assert.notEqual(guest.gameId, oldGame, '客机拿到新 gameId');
  assert.equal(guest.gameId, host.gameId);
  assert.equal(guest.state.seq, host.state.seq);
});

test('中继联机：房主关掉中继后，客机的指令不再生效（关房要能干净收场）', async () => {
  const { host, guest, seen } = await pair();
  await sleep(120); // 等 join 引发的几帧推完，再关房，免得把在途的包算进来
  host.close();
  const before = seen.guest.length;
  const seq0 = host.state.seq;
  guest.act('B', { type: 'PASS_FUNCTION' });
  await sleep(60);
  assert.equal(host.state.seq, seq0, '关房后房主不再执行任何指令');
  assert.equal(seen.guest.length, before, '关房后不再推送新帧');
  guest.close(); // 客机这边关掉也不能抛
});
