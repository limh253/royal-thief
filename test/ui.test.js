import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, el, sleep, clickPrompt, clickPromptValue, clickReward, clickHandCard, handHas } from './dom-shim.js';

const E = installDom().el;
const get = (id) => E(id);
const app = await import('../web/app.js');
app.setBotDelay(5);

test('界面：初始渲染（牌面朝上 / 对手暗置 / 阶段条）', async () => {
  app.startGame(5, 'ai');   // 固定种子：A 手牌含人牌与功能牌
  await sleep(10);
  assert.match(get('handA').innerHTML, /data-card="p\d+"/, 'A 的手牌应渲染为卡面');
  assert.match(get('handA').innerHTML, /data-card="f\d+"/, 'A 手上有功能牌');
  assert.match(get('handB').innerHTML, /card back/, 'B 的手牌应渲染为背面');
  assert.equal(/data-card=/.test(get('handB').innerHTML), false, 'B 的手牌不得泄漏到页面');
  assert.match(get('phasebar').innerHTML, /抽牌/);
  assert.match(get('prompt').innerHTML, /功能牌阶段|不打出功能牌|没有功能牌/);
  assert.match(get('seed').textContent, /5/);
});

test('界面：驱动一整局人机对战，全程无异常且终局弹窗出现', async () => {
  app.startGame(5, 'ai');
  await sleep(10);
  let steps = 0;
  for (let guard = 0; guard < 600; guard++) {
    if (get('ovcard').innerHTML.includes('再来一局')) break;
    steps += 1;
    const p = get('prompt').innerHTML;
    if (p.includes('data-act="cancel-give"')) { clickPromptValue('cancel-give'); continue; }
    if (handHas('give')) { clickPrompt('give'); continue; }
    if (p.includes('data-act="fight"')) {
      if (clickPrompt('person')) clickPromptValue('fight');
      else clickPromptValue('pass-declare');
      continue;
    }
    if (p.includes('data-act="pass-declare"')) { clickPromptValue('pass-declare'); continue; }
    if (p.includes('data-act="pass"')) { clickPromptValue('pass'); continue; }
    if (p.includes('data-act="reward-ok"')) { clickReward('keep'); clickPromptValue('reward-ok'); continue; }
    await sleep(20);
  }
  assert.ok(steps > 3, '至少应推进若干步');
  const ov = get('ovcard').innerHTML;
  assert.match(ov, /再来一局/, '终局应弹出结算面板');
  assert.match(ov, /胜|平局/);
  assert.match(ov, /玩家 A 手牌/);
});

test('界面：热座模式按人遮屏（能力牌阶段双方同时暗置）', async () => {
  app.startGame(3, 'hotseat');
  assert.match(get('ovcard').innerHTML, /请将设备交给玩家 A/);
  get('overlay').fire('click', { target: { dataset: { act: 'ready' } } });
  assert.match(get('prompt').innerHTML, /请打出一张能力牌|不打出功能牌/);

  assert.equal(clickPromptValue('pass'), true, '能力牌阶段应能跳过');
  assert.match(get('ovcard').innerHTML, /请将设备交给玩家 B/, 'A 提交能力牌后应遮屏交给 B');
  get('overlay').fire('click', { target: { dataset: { act: 'ready' } } });
  assert.equal(clickPromptValue('pass'), true, 'B 也要提交本回合能力牌');
  assert.match(get('prompt').innerHTML, /请出一道角色牌|选择出战人牌/);

  assert.equal(clickPromptValue('pass-declare'), true, '不出战');
  assert.match(get('ovcard').innerHTML, /请将设备交给玩家 B/, 'A 宣告后交给 B 暗置宣告');
});

test('界面：观战模式双方手牌均亮出，并会自动推进', async () => {
  app.startGame(5, 'demo');
  await sleep(200);
  assert.match(get('handB').innerHTML, /data-card=/, '观战模式应亮出 B 的手牌');
  const before = get('log').innerHTML.length;
  await sleep(200);
  assert.notEqual(get('log').innerHTML.length, before, '观战模式应持续推进');
});

test('界面：规则面板与私有日志切换', async () => {
  app.startGame(5, 'ai');
  get('btnRules').fire('click', { target: { dataset: {} } });
  assert.match(get('ovcard').innerHTML, /规则速览|骑士/);
  get('overlay').fire('click', { target: { dataset: { act: 'close-rules' } } });
  get('tabs').fire('click', { target: { dataset: { log: 'priv' } } });
  assert.match(get('log').innerHTML, /暂无|私有|背水/);
});
test('界面：整局带道具出战（会触发贼效果）全程不出现诊断条报错', async () => {
  app.startGame(1, 'ai');
  await sleep(10);
  let steps = 0;
  for (let guard = 0; guard < 1200; guard++) {
    if (get('ovcard').innerHTML.includes('再来一局')) break;
    const p = get('prompt').innerHTML;
    if (p.includes('data-act="cancel-give"')) { clickPromptValue('cancel-give'); continue; }
    if (handHas('give')) { clickPrompt('give'); continue; }
    if (p.includes('data-act="fight"') && handHas('person')) {
      steps += 1;
      clickPrompt('person');
      if (handHas('item')) clickPrompt('item');
      clickPromptValue('fight');
      continue;
    }
    if (p.includes('data-act="pass-declare"')) { steps += 1; clickPromptValue('pass-declare'); continue; }
    if (p.includes('data-act="pass"')) { steps += 1; clickPromptValue('pass'); continue; }
    if (p.includes('data-act="reward-ok"')) { clickReward('keep'); clickPromptValue('reward-ok'); continue; }
    await sleep(20);
  }
  assert.ok(steps > 3, '至少应推进若干步');
  assert.equal(get('fatal').innerHTML, '', '界面不得因为事件字段缺失而报错（贼效果无武器时曾整页卡死）');
  assert.match(get('ovcard').innerHTML, /再来一局/, '整局应能正常打完');
});

test('界面：洞若观火/重整的结果要弹给本人（曾经只写进私有日志，看着像没效果）', async () => {
  let hit = 0;
  for (let seed = 1; seed <= 80 && !hit; seed++) {
    app.startGame(seed, 'ai');
    await sleep(3);
    if (/data-play="f\d+"[^>]*data-face="洞若观火"/.test(get('handA').innerHTML)) hit = seed;
  }
  assert.ok(hit, '需要先找到一个 A 起手就有洞若观火的种子');
  assert.equal(clickHandCard('play', '洞若观火'), true, '点手牌里的洞若观火即可直接打出');
  await sleep(10);
  assert.match(get('peekCard').innerHTML, /class="card/, '要亮出具体看到的是哪张牌');
  assert.match(get('peekInfo').innerHTML, /洞若观火/, '要把探查结果弹给探查者（标题在 peekInfo 里）');
  assert.match(get('peekInfo').innerHTML, /只有你能看到/, '要写明对手看不到');
  assert.match(get('tagsA').innerHTML, /已窥探/, '本回合内要能回看');
  assert.equal(/已窥探/.test(get('tagsB').innerHTML), false, '对手那一侧不得出现任何窥探提示');
  assert.equal(get('fatal').innerHTML, '', '不得报错');
});

test('界面：战斗判定逐条回放的分支文案（贼效果 / 平局 / 战利品去向）', () => {
  const story = {
    reveal: {
      A: { person: '人(善)', item: '隐身衣', identity: '贼', fight: true },
      B: { person: '人(恶)', item: '武器', identity: '匪徒', fight: true },
    },
    cloaks: ['A'],
    steals: [{ side: 'A', from: 'B', stolen: true }],
    result: { kind: 'draw', ia: '贼', ib: '匪徒' },
    penalties: [], choice: null, settled: false,
  };
  const r = app.__battleHtmlForTest(story);
  assert.deepEqual(r.steps, ['reveal', 'thief', 'ident', 'settle'], '有贼效果时应插入独立的「贼效果」步骤');
  const at = (st, i) => app.__battleHtmlForTest(st, i).html;
  assert.match(at(story, 0), /同时亮牌/, '第一步是同时亮牌');
  assert.match(at(story, 0), /贼/, '亮牌要写明身份');
  assert.match(at(story, 1), /贼效果优先结算/);
  assert.match(at(story, 1), /弃掉隐身衣/);
  assert.match(at(story, 1), /夺走 B 出战组合里的武器/);
  assert.match(at(story, 2), /互不克制/, '平局要写明互不克制');
  assert.match(at(story, 3), /双方出战卡牌全部进入弃牌堆/);
  assert.equal(at(story, 3).includes('弃掉隐身衣'), false, '判定区一次只显示当前这一步，不堆叠');
  assert.match(r.sideA, /人（善）/, '亮牌阶段要把出战人牌画到场上');
  assert.match(r.sideA, /隐身衣/);

  const win = { ...story, result: { kind: 'win', winner: 'A', ia: '贼', ib: '匪徒' }, choice: 'take' };
  assert.match(at(win, 3), /收入手牌/, '胜者选②时要写清对手的牌进了胜者手牌');
  assert.equal(/人\(恶\) \+ 武器 → 弃牌堆/.test(at(win, 3)), false);

  const keep = { ...story, result: { kind: 'win', winner: 'B', ia: '贼', ib: '匪徒' }, choice: 'keep' };
  assert.match(at(keep, 3), /保留自己的出战牌/);

  const skip = { reveal: null, cloaks: [], steals: [], result: { kind: 'skip' }, penalties: [{ passer: 'A', taker: 'B' }], choice: null, settled: false };
  assert.deepEqual(app.__battleHtmlForTest(skip).steps, ['skip']);
  assert.match(at(skip, 0), /随机夺走 A 手牌里的 1 张/);
});
test('界面：台面大字提示（请出牌 / 请选择手牌）+ 回合转换横幅', async () => {
  // 记录横幅标题的变化：dom-shim 里 canAnimate() 为假，横幅是同步写入的
  const bt = get('bannerT');
  const seen = [];
  Object.defineProperty(bt, 'textContent', {
    configurable: true,
    get() { return bt._text; },
    set(v) { seen.push(String(v)); bt._text = String(v); },
  });
  app.startGame(5, 'ai');
  await sleep(10);

  // ① 功能牌阶段：台面弹出大字提示 + 跳过按钮，并且浮到手牌上方（dock）
  let p = get('prompt').innerHTML;
  assert.match(p, /class="askt"/, '需要点选时应在牌桌中央弹出大字提示');
  assert.match(p, /请打出一张能力牌/, '功能牌阶段要问「请打出一张能力牌」');
  assert.match(p, /跳过 · 不打出功能牌/, '要留一个跳过按钮');
  assert.equal(get('prompt').classList.contains('dock'), true, '提示要浮到牌桌中央手牌上方，不再挤在底栏');

  // ② 回合转换横幅：开局先报「轮到谁」
  assert.ok(seen.includes('你的回合'), '回合转换时要提示轮到谁，实际看到：' + JSON.stringify(seen.slice(0, 6)));

  // ③ 推心置腹：请选择一张你要交换的手牌（手牌里能选的那几张浮起来）
  let hit = 0;
  for (let seed = 1; seed <= 200 && !hit; seed++) {
    app.startGame(seed, 'ai');
    await sleep(3);
    if (/data-play="f5"[^>]*data-face="推心置腹"/.test(get('handA').innerHTML)) hit = seed;
  }
  assert.ok(hit, '需要先找到一个 A 起手就有推心置腹的种子');
  assert.equal(clickHandCard('play', '推心置腹'), true, '点手牌里的推心置腹即可直接打出');
  await sleep(6);
  p = get('prompt').innerHTML;
  assert.match(p, /请选择一张你要交换的手牌/, '推心置腹要问「请选择一张你要交换的手牌」');
  assert.match(p, /data-act="cancel-give"/, '要留一个取消按钮');
  assert.match(get('handA').innerHTML, /data-give=/, '能交换的手牌要直接可点');
  assert.match(get('handA').innerHTML, /class="card[^"]*\bpicking\b/, '手牌里能交换的那几张要浮起来（可直接点）');
  assert.equal(clickPromptValue('cancel-give'), true, '取消要能点');
  await sleep(6);
  assert.equal(/\bpicking\b/.test(get('handA').innerHTML), false, '取消后手牌恢复原状');

  // ④ 对抗宣告：请出一道角色牌
  app.startGame(5, 'ai');
  await sleep(10);
  assert.equal(clickPromptValue('pass'), true, '功能牌阶段应能跳过');
  await sleep(6);
  p = get('prompt').innerHTML;
  assert.match(p, /请出一道角色牌/, '宣告阶段要问「请出一道角色牌」');
  assert.match(get('handA').innerHTML, /data-person=/, '可出战的人牌要能直接点');
  assert.equal(get('prompt').classList.contains('dock'), true, '宣告阶段同样浮在牌桌中央');
  assert.match(p, /data-act="pass-declare"/, '要留一个不出战按钮');
  assert.equal(get('fatal').innerHTML, '', '不得报错');
});
test('界面：战利品点选（两张出战牌都放暗，点哪张哪张变亮，再确认）', async () => {
  app.startGame(1, 'ai');
  await sleep(10);
  let hit = false;
  for (let guard = 0; guard < 2000 && !hit; guard++) {
    const p = get('prompt').innerHTML;
    if (p.includes('请点一张你想留下的牌')) { hit = true; break; }
    if (p.includes('data-act="cancel-give"')) { clickPromptValue('cancel-give'); continue; }
    if (handHas('give')) { clickPrompt('give'); continue; }
    if (p.includes('data-act="fight"') && handHas('person')) {
      clickPrompt('person');
      if (handHas('item')) clickPrompt('item');
      clickPromptValue('fight');
      continue;
    }
    if (p.includes('data-act="pass-declare"')) { clickPromptValue('pass-declare'); continue; }
    if (p.includes('data-act="pass"')) { clickPromptValue('pass'); continue; }
    if (p.includes('data-act="reward-ok"')) { clickReward('keep'); clickPromptValue('reward-ok'); continue; }
    await sleep(6);
  }
  assert.ok(hit, '固定种子 1 应能走到战利品点选');

  const slots = () => get('slotA').innerHTML + get('slotB').innerHTML;
  assert.match(slots(), /class="pickwrap/, '两张出战牌要包成可点选的 pickwrap');
  assert.match(slots(), /data-reward="keep"/);
  assert.match(slots(), /data-reward="take"/);
  assert.match(slots(), /class="pickhint"/, '每张牌下面要有「点它会怎样」的小字');
  assert.equal(get('arena').classList.contains('choosing'), true, '点选期间牌桌进入 choosing 态');

  let p = get('prompt').innerHTML;
  assert.match(p, /请点一张你想留下的牌/);
  assert.match(p, /class="pickline"/, '要有「还没选」的状态行');
  assert.match(p, /data-act="reward-ok" disabled/, '没选之前确认按钮要禁用');

  clickReward('keep');
  p = get('prompt').innerHTML;
  assert.match(p, /确认你的选择/);
  assert.match(p, /pickline on/, '选中后状态行要变成已选');
  assert.match(p, /data-act="reward-reset"/, '要能重选');
  assert.equal(/data-act="reward-ok" disabled/.test(p), false, '选中后确认按钮要能点');
  assert.match(slots(), /class="pickwrap on"/, '选中的那张要变亮放大');

  clickReward('keep');
  assert.match(get('prompt').innerHTML, /请点一张你想留下的牌/, '再点一次同一张 = 取消选择');

  clickReward('take');
  assert.match(get('prompt').innerHTML, /留下对手的出战牌/, '换选另一张要能改主意');
  assert.match(slots(), /class="pickwrap on"/);

  assert.equal(clickPromptValue('reward-ok'), true, '确认要能提交');
  await sleep(20);
  assert.equal(get('fatal').innerHTML, '', '提交战利品选择不得报错');
});