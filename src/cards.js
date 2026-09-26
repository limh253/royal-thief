export const ALIGNS = ['善', '恶'];
export const ITEM_NAMES = ['武器', '皇冠', '隐身衣'];
export const FUNCTION_NAMES = ['洞若观火', '重整', '颠倒是非', '铸剑为犁', '推心置腹', '沉默', '止戈'];
export const DEFAULT_PERSON_COPIES = { 善: 6, 恶: 6 };
export const DEFAULT_ITEM_COPIES = { 武器: 6, 皇冠: 2, 隐身衣: 1 };

export const isPerson = (c) => c.kind === 'person';
export const isItem = (c) => c.kind === 'item';
export const isFunctionCard = (c) => c.kind === 'function';
export const isCrown = (c) => c.kind === 'item' && c.name === '皇冠';
export const isWeapon = (c) => c.kind === 'item' && c.name === '武器';
export const isCloak = (c) => c.kind === 'item' && c.name === '隐身衣';

export function label(c) {
  if (!c) return '(无)';
  return isPerson(c) ? `人(${c.align})` : c.name;
}

export function buildCards(spec = {}) {
  const cards = {};
  let n = 0;
  const personCopies = spec.personCopies ?? DEFAULT_PERSON_COPIES;
  for (const align of ALIGNS) {
    for (let i = 0; i < (personCopies[align] ?? 0); i++) {
      const id = `p${++n}`;
      cards[id] = { id, kind: 'person', name: '人', align };
    }
  }
  let m = 0;
  const itemCopies = spec.itemCopies ?? DEFAULT_ITEM_COPIES;
  for (const name of ITEM_NAMES) {
    for (let i = 0; i < (itemCopies[name] ?? 0); i++) {
      const id = `i${++m}`;
      cards[id] = { id, kind: 'item', name, align: null };
    }
  }
  let k = 0;
  for (const name of FUNCTION_NAMES) {
    const copies = spec.functionCopies?.[name] ?? 1;
    for (let i = 0; i < copies; i++) {
      const id = `f${++k}`;
      cards[id] = { id, kind: 'function', name, align: null };
    }
  }
  return cards;
}