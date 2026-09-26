// 所有可调参数集中在这里，平衡性试玩只改这个文件。
export const RULES = {
  initialHandSize: 4,          // 初始手牌 4 张
  crownCap: 1,                 // 手牌皇冠上限
  maxRounds: 40,               // 全局回合上限（A+B 记 1 个完整回合）
  stalemateRounds: 3,          // 牌堆耗尽后，连续 N 个完整回合无战斗胜负即结算
  zhiGeGoal: 1,                // 止戈计数达到该值 + 主牌堆为空 => 结算。阈值必须是 1：止戈全局只有 1 张，不可能"连续两次背靠背"
  zhiGeCopies: 1,              // 止戈张数：全局仅 1 张（牌组 28 张）
  passPenaltyAppliesToAllPassers: true, // 同时宣告模型下，未行动方"不出战"是否也吃惩罚
  revealHandCounts: false,     // 是否公开对手手牌数量（背水一战条款要求默认隐藏）
  revealDeckCount: false,      // 是否公开主牌堆剩余数量（默认隐藏：重整条款只告知抽到的牌，不提示牌堆剩余）
  revealDiscard: true,         // 弃牌堆是否公开
  drawDiscardsBattleCards: true, // 平局处理：true = 双方出战牌都进弃牌堆（不返还手牌，平局要实打实掉牌）
};

export const IDENTITIES = ['骑士', '匪徒', '国王', '普通人', '贼'];

// 克制表：BEATS[x] = x 能克制的身份列表
export const BEATS = {
  骑士: ['匪徒', '普通人'],
  匪徒: ['国王', '普通人'],
  国王: ['骑士'],
  普通人: ['国王'],
  贼: [], // Q2 决议：贼无克制，对任意身份均为平局
};

export function compareIdentity(a, b) {
  if (BEATS[a]?.includes(b)) return 'a';
  if (BEATS[b]?.includes(a)) return 'b';
  return 'draw';
}

// Q2 决议：身份在出战组合锁定瞬间冻结，后续弃隐身衣/夺武器都不回溯身份。
export function identityOf({ person, item }, berserk = false) {
  if (!person) throw new Error('出战组合必须包含人牌');
  if (!item) return berserk ? (person.align === '善' ? '骑士' : '匪徒') : '普通人';
  if (item.name === '武器') return person.align === '善' ? '骑士' : '匪徒';
  if (item.name === '皇冠') return '国王';
  if (item.name === '隐身衣') return '贼';
  throw new Error(`未知道具牌：${item.name}`);
}