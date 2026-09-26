import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createGame, apply } from '../src/engine.js';
import { viewFor } from '../src/view.js';
import { isFunctionCard, isPerson, isItem, isWeapon, isCrown, isCloak } from '../src/cards.js';

class EofExit extends Error {}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// 真终端：逐条交互询问；管道/重定向：先读完输入，再逐条消费（便于脚本化验收与自动测试）。
const scripted = !process.stdin.isTTY;
let rl = null;
let closed = false;
let lines = [];
if (scripted) {
  lines = (await readAll(input)).split(/\r?\n/);
} else {
  rl = readline.createInterface({ input, output });
  rl.on('close', () => { closed = true; });
}

const ask = async (q) => {
  if (scripted) {
    output.write(q);
    if (!lines.length) {
      output.write('\n');
      throw new EofExit();
    }
    const value = lines.shift();
    output.write(`${value}\n`);
    return value.trim();
  }
  if (closed) throw new EofExit();
  try {
    return (await rl.question(q)).trim();
  } catch {
    throw new EofExit();
  }
};

const mirror = (id) => (id === 'A' ? 'B' : 'A');
const cardText = (s, id) => {
  const c = s.cards[id];
  return c.kind === 'person' ? `人(${c.align})` : c.name;
};

function showView(s, who) {
  const v = viewFor(s, who);
  console.log('\n' + '-'.repeat(56));
  console.log(`第 ${v.round} 回合 · 当前行动方 ${v.turn} · 阶段 ${v.phase}`);
  console.log(`【${who} 的手牌】 ` + (v.yourHand.length ? v.yourHand.map((c) => `${c.id}=${c.label}`).join('  ') : '(空)'));
  if (v.opponentHandEmpty) console.log(`【对手手牌】 已空`);
  else if (v.opponentHandCount !== null) console.log(`【对手手牌】 ${v.opponentHandCount} 张`);
  else console.log(`【对手手牌】 数量未知`);
  console.log(`【主牌堆】 ${v.deckEmpty ? '已空' : `剩余 ${v.deckCount === null ? '未知' : v.deckCount}`}   【止戈计数】 ${v.atWarCounter}`);
  if (v.youSilenced) console.log('>>> 你本回合被沉默，无法打出功能牌');
  if (v.yourSeenThisTurn.length) console.log(`【本回合探查回看】 ${v.yourSeenThisTurn.map((c) => c.label).join('  ')}`);
  const priv = v.privateLog.slice(-4);
  if (priv.length) console.log(priv.map((l) => `  · [私有] ${l}`).join('\n'));
  const pub = v.publicLog.slice(-6);
  if (pub.length) console.log(pub.map((l) => `  · ${l}`).join('\n'));
}

async function askFunction(s, who) {
  const hand = s.players[who].hand;
  const playable = hand.filter((id) => isFunctionCard(s.cards[id]));
  if (!playable.length) {
    console.log(`（${who} 手中没有功能牌，自动跳过）`);
    return { type: 'PASS_FUNCTION' };
  }
  console.log('可打出的功能牌：');
  playable.forEach((id, i) => console.log(`  ${i + 1}. ${cardText(s, id)}`));
  const a = await ask(`选择要打出的功能牌序号，或直接回车跳过 > `);
  if (!a) return { type: 'PASS_FUNCTION' };
  const idx = Number(a) - 1;
  if (!(idx >= 0 && idx < playable.length)) return { type: 'PASS_FUNCTION' };
  const cardId = playable[idx];
  const cmd = { type: 'PLAY_FUNCTION', cardId };
  if (s.cards[cardId].name === '推心置腹') {
    const giveable = hand.filter((id) => id !== cardId && !isFunctionCard(s.cards[id]));
    if (giveable.length) {
      console.log('选择要交出的卡牌：');
      giveable.forEach((id, i) => console.log(`  ${i + 1}. ${cardText(s, id)}`));
      const g = Number(await ask('序号 > ')) - 1;
      if (g >= 0 && g < giveable.length) cmd.giveCardId = giveable[g];
    }
  }
  return cmd;
}

async function askDeclare(s, who) {
  const hand = s.players[who].hand;
  const persons = hand.filter((id) => isPerson(s.cards[id]));
  const items = hand.filter((id) => isItem(s.cards[id]));
  if (s.berserk[who]) console.log(`>>> 背水一战判定成立（仅你可见）：出战将临时变身为${s.cards[persons[0]].align === '善' ? '骑士' : '匪徒'}`);
  if (!persons.length) {
    console.log(`（${who} 手中没有人牌，只能不出战）`);
    return { type: 'DECLARE', playerId: who, fight: false };
  }
  const y = await ask(`是否出战？(y/n) > `);
  if (y.toLowerCase() !== 'y') return { type: 'DECLARE', playerId: who, fight: false };
  console.log('选择出战人牌：');
  persons.forEach((id, i) => console.log(`  ${i + 1}. ${cardText(s, id)}`));
  const pi = Number(await ask('序号 > ')) - 1;
  if (!(pi >= 0 && pi < persons.length)) return { type: 'DECLARE', playerId: who, fight: false };
  const cmd = { type: 'DECLARE', playerId: who, fight: true, personCardId: persons[pi] };
  if (items.length) {
    console.log('是否搭配 1 张道具牌？');
    items.forEach((id, i) => console.log(`  ${i + 1}. ${cardText(s, id)}`));
    const ii = Number(await ask('序号，或回车不搭配 > ')) - 1;
    if (ii >= 0 && ii < items.length) cmd.itemCardId = items[ii];
  }
  return cmd;
}

const seed = Number(process.argv[2] ?? 1);
const s = createGame(seed);
console.log(`王权窃贼 · 热座对战（种子 ${seed}）—— 每位玩家操作前请勿让对方看到屏幕`);

try {
while (!s.winner) {
  const p = s.pending;
  if (!p) break;
  if (p.kind === 'function-phase') {
    const order = [s.turn, mirror(s.turn)];
    for (const who of order) {
      if (s.pending?.kind !== 'function-phase' || s.pending.submitted.includes(who)) continue;
      showView(s, who);
      console.log(`\n==> ${who} 选一张能力牌（双方同时暗置，都提交后依次结算）`);
      apply(s, { ...(await askFunction(s, who)), playerId: who });
    }
  } else if (p.kind === 'declare-phase') {
    const order = [s.turn, mirror(s.turn)];
    for (const who of order) {
      if (s.pending?.kind !== 'declare-phase' || s.pending.submitted.includes(who)) continue;
      showView(s, who);
      console.log(`\n==> ${who} 的本回合宣告（同时暗置，提交后不可修改）`);
      apply(s, await askDeclare(s, who));
    }
    if (s.pending?.kind === 'declare-phase') {
      console.log('（等待另一方提交宣告）');
      const who = s.pending.submitted.includes('A') ? 'B' : 'A';
      showView(s, who);
      apply(s, await askDeclare(s, who));
    }
  } else if (p.kind === 'battle-reward') {
    showView(s, p.winner);
    const a = await ask(`\n==> ${p.winner} 胜出，选择处理方式：1=保留自己的出战卡牌 2=弃掉自己的并收入对手出战卡牌 > `);
    apply(s, { type: 'CHOOSE_REWARD', playerId: p.winner, option: a === '2' ? 'take' : 'keep' });
  }
}
} catch (err) {
  if (err instanceof EofExit) {
    console.log('\n（输入已结束，本局中断退出；重新运行即开新局）');
    process.exit(0);
  }
  throw err;
}

console.log('\n' + '='.repeat(56));
console.log(`结果：${s.winner.kind === 'draw' ? '平局' : `${s.winner.id} 胜`} —— ${s.winner.reason}`);
console.log(`A 手牌：${s.players.A.hand.map((id) => cardText(s, id)).join('、') || '(空)'}`);
console.log(`B 手牌：${s.players.B.hand.map((id) => cardText(s, id)).join('、') || '(空)'}`);
if (rl) rl.close();