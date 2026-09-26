import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../web/session.js';
import { other } from '../src/engine.js';

test('会话层：人机模式驱动到终局（人类侧用保守策略）', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const s = createSession({ seed, mode: 'ai' });
    let guard = 0;
    while (!s.state.winner) {
      if (++guard > 5000) throw new Error('未终止');
      const actor = s.actor();
      assert.ok(actor, `seed ${seed} 出现无人待办却未终局`);
      if (s.isBot(actor)) {
        const cmd = s.botCommand(actor);
        assert.ok(cmd, '机器人必须给出指令');
        s.act(actor, cmd);
        continue;
      }
      const p = s.state.pending;
      if (p.kind === 'function-phase') s.act(actor, { type: 'PASS_FUNCTION' });
      else if (p.kind === 'battle-reward') s.act(actor, { type: 'CHOOSE_REWARD', playerId: actor, option: 'keep' });
      else {
        const persons = s.state.players[actor].hand.filter((id) => s.state.cards[id].kind === 'person');
        s.act(actor, persons.length
          ? { type: 'DECLARE', playerId: actor, fight: false }
          : { type: 'DECLARE', playerId: actor, fight: false });
      }
    }
    assert.ok(s.state.winner);
  }
});

test('会话层：热座模式下宣告阶段按 A 先 B 后的顺序索要指令', () => {
  const s = createSession({ seed: 3, mode: 'hotseat' });
  s.act('A', { type: 'PASS_FUNCTION' });
  assert.equal(s.state.pending.kind, 'function-phase', '能力牌阶段双方同时，等 B 提交');
  assert.equal(s.actor(), 'B');
  s.act('B', { type: 'PASS_FUNCTION' });
  assert.equal(s.state.pending.kind, 'declare-phase');
  assert.equal(s.actor(), 'A');
  s.act('A', { type: 'DECLARE', playerId: 'A', fight: false });
  assert.equal(s.actor(), 'B', 'A 提交后轮到 B 暗置提交');
  s.act('B', { type: 'DECLARE', playerId: 'B', fight: false });
  assert.equal(s.actor(), 'B', '进入 B 的回合');
});

test('会话层：view() 不泄漏对手手牌', () => {
  const s = createSession({ seed: 5, mode: 'hotseat' });
  const va = s.view('A');
  const bIds = s.state.players.B.hand;
  const text = JSON.stringify(va);
  for (const id of bIds) assert.equal(text.includes(`"${id}"`), false, `A 的视图不应含 ${id}`);
  assert.equal(va.opponentHandCount, null);
});

test('会话层：other() 正确换手', () => {
  assert.equal(other('A'), 'B');
  assert.equal(other('B'), 'A');
});