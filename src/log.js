export function pushEvent(state, event) {
  const e = { seq: (state.seq += 1), ...event };
  state.events.push(e);
  return e;
}

// 信息隐藏规则：功能牌结算只公开提示"结算完成"。
export function complete(state) {
  pushEvent(state, { type: 'complete', scope: 'all', text: '结算完成' });
}