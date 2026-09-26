import { createGame, apply, other } from '../src/engine.js';
import { viewFor } from '../src/view.js';
import { makeBot } from '../src/bot.js';

// 界面无关的对局会话：谁该行动、谁能看到什么、机器人怎么走。
// 与 DOM 分离，浏览器和 Node 测试共用同一份。（other() 直接复用 engine.js 的实现）
export function createSession({ seed = 1, mode = 'ai', botSeed = 7, fightChance = 0.65 } = {}) {
  const state = createGame(seed);
  const bot = makeBot(botSeed, { fightChance });
  return {
    state,
    mode,
    seed,
    isBot(playerId) {
      if (mode === 'demo') return true;
      return mode === 'ai' && playerId === 'B';
    },
    view(playerId) {
      return viewFor(state, playerId);
    },
    act(playerId, command) {
      // 指令统一带上「谁在操作」，引擎不用从 pending 里猜
      apply(state, { playerId, ...command });
      return state;
    },
    // 当前必须由谁提交指令；无人待办（终局）返回 null
    actor() {
      const p = state.pending;
      if (state.winner || !p) return null;
      // 能力牌 / 宣告都是双方同时暗置：由当前回合玩家先提交，再轮到对手
      if (p.kind === 'function-phase' || p.kind === 'declare-phase') {
        return p.submitted.includes(state.turn) ? other(state.turn) : state.turn;
      }
      if (p.kind === 'battle-reward') return p.winner;
      return null;
    },
    waitingFor() {
      const p = state.pending;
      if (p?.kind !== 'function-phase' && p?.kind !== 'declare-phase') return null;
      return p.submitted.includes(state.turn) ? other(state.turn) : state.turn;
    },
    botCommand(playerId) {
      return bot.next(state, playerId);
    },
    eventsSince(seq) {
      return state.events.filter((e) => e.seq > seq);
    },
  };
}