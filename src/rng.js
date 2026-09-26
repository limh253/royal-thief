// 可复现随机源：全部随机性都从 state.rngState 派生，方便回放与复盘。
export function rnd(state) {
  let s = (state.rngState + 0x6d2b79f5) >>> 0;
  state.rngState = s;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(state, n) {
  if (n <= 0) throw new Error('randInt: n 必须为正整数');
  return Math.floor(rnd(state) * n);
}

export function pickOne(state, arr) {
  return arr[randInt(state, arr.length)];
}

export function shuffle(state, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(state, i + 1);
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}