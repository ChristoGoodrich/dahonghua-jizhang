// Categories — ported from v7's BASE_CATS / EMOJI_POOL / allCats / catOf.
import type { Category, IO } from './types';

export const BASE_CATS: Record<IO, Category[]> = {
  exp: [
    { k: 'food', e: '🍜', zh: '餐饮', en: 'Food', c: '#E89B6C' },
    { k: 'shop', e: '🛍️', zh: '购物', en: 'Shopping', c: '#D08496' },
    { k: 'trans', e: '🚇', zh: '交通', en: 'Transit', c: '#7FA8C9' },
    { k: 'home', e: '🏠', zh: '居家', en: 'Home', c: '#9B8FC9' },
    { k: 'fun', e: '🎮', zh: '娱乐', en: 'Fun', c: '#6FB59A' },
    { k: 'health', e: '💊', zh: '医疗', en: 'Health', c: '#D88AA0' },
    { k: 'study', e: '📚', zh: '学习', en: 'Study', c: '#C9A35C' },
    { k: 'gift', e: '🎁', zh: '人情', en: 'Gifts', c: '#D08C6C' },
    { k: 'travel', e: '✈️', zh: '旅行', en: 'Travel', c: '#6FA8B5' },
    { k: 'other', e: '📦', zh: '其他', en: 'Other', c: '#A89E92' },
  ],
  inc: [
    { k: 'salary', e: '💰', zh: '工资', en: 'Salary', c: '#6FA88F' },
    { k: 'bonus', e: '🧧', zh: '奖金', en: 'Bonus', c: '#D94E5C' },
    { k: 'invest', e: '📈', zh: '理财', en: 'Invest', c: '#6FA88F' },
    { k: 'parttime', e: '💼', zh: '兼职', en: 'Side job', c: '#7C9C8F' },
    { k: 'other', e: '✨', zh: '其他', en: 'Other', c: '#E8A838' },
  ],
  xfer: [], // transfers have no categories; kept so allCats/Record<IO,…> stay total
};

export const EMOJI_POOL = ['🍱','☕','🍰','🍺','🐱','👗','💄','🎬','🎵','🏋️','📱','💡','🚗','⛽','🎓','🌷','🧧','🎯','🛒','🧋','🍔','🎁','💊','✂️','📷','🐶','🌍','🪴'];

export const CAT_PALETTE = ['#C9778A','#7FA8C9','#6FB59A','#C9A35C','#9B8FC9','#D08C6C','#6FA8B5','#D88AA0'];

export function allCats(io: IO, custom: Record<IO, Category[]>): Category[] {
  return [...(BASE_CATS[io] ?? []), ...(custom?.[io] ?? [])];
}

// Shown for transfers (which have no real category) and as a total-function
// guard so catOf never returns undefined for an empty list (e.g. io='xfer').
export const TRANSFER_CAT: Category = { k: 'transfer', e: '🔄', zh: '转账', en: 'Transfer', c: '#A89E92' };

/** Look up a category, falling back to the last one (matches v7 behavior). */
export function catOf(io: IO, k: string, custom: Record<IO, Category[]>): Category {
  const list = allCats(io, custom);
  return list.find((c) => c.k === k) ?? list[list.length - 1] ?? TRANSFER_CAT;
}

export function catName(c: Category, lang: 'zh' | 'en'): string {
  return lang === 'zh' ? c.zh || c.en : c.en || c.zh;
}
