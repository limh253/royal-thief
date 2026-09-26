import { createGame } from '../src/engine.js';
import { autoplay } from '../src/bot.js';
import { RULES } from '../src/rules.js';

const args = process.argv.slice(2);
const getArg = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : dflt;
};
const games = Number(getArg('games', 0));
const fightChance = Number(getArg('fight', 0.65));

if (games > 0) {
  const stats = {};
  const wins = { A: 0, B: 0 };
  for (let seed = 1; seed <= games; seed++) {
    const s = createGame(seed);
    autoplay(s, seed, { fightChance });
    const key = s.winner.reason.includes('止戈') ? '止戈'
      : s.winner.reason.includes('连续') ? '僵局兜底'
      : s.winner.reason.includes('回合上限') ? '回合上限'
      : s.winner.reason.includes('同时归零') ? '平局'
      : s.winner.reason.includes('手牌归零') ? '手牌归零'
      : '平局';
    stats[key] = (stats[key] ?? 0) + 1;
    if (s.winner.kind === 'player') wins[s.winner.id] += 1;
  }
  console.log(`自动对局 ${games} 局（出战倾向 ${fightChance}）：`);
  for (const [k, v] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(6)} ${String(v).padStart(5)} 局  ${(v / games * 100).toFixed(1)}%`);
  }
  console.log(`  A 胜 ${wins.A} / B 胜 ${wins.B}（A 先手）`);
  process.exit(0);
}

const seed = Number(getArg('seed', 1));
const s = createGame(seed);
autoplay(s, seed, { fightChance });
console.log(`===== 王权窃贼 · 种子 ${seed} · 自动对局回放（仅公开信息） =====`);
for (const e of s.events) {
  if (e.scope === 'private') continue;
  console.log(`[${String(e.seq).padStart(3, '0')}] ${e.text}`);
}
console.log('===== 终局 =====');
console.log(`回合数 ${s.round} / 上限 ${RULES.maxRounds}，主牌堆剩余 ${s.deck.length}，弃牌堆 ${s.discard.length}`);
console.log(`结果：${s.winner.kind === 'draw' ? '平局' : `${s.winner.id} 胜`} —— ${s.winner.reason}`);
console.log(`A 手牌（上帝视角）：${s.players.A.hand.map((id) => (s.cards[id].kind === 'person' ? `人(${s.cards[id].align})` : s.cards[id].name)).join('、')}`);
console.log(`B 手牌（上帝视角）：${s.players.B.hand.map((id) => (s.cards[id].kind === 'person' ? `人(${s.cards[id].align})` : s.cards[id].name)).join('、')}`);