// Smart insight banner — ported from v7's computeInsight().
// Priority: total-budget state -> category-budget breach -> biggest category.
import type { Category, Entry, IO, Settings } from './types';
import { catOf, catName } from './cats';
import type { Lang } from '@/i18n';

export interface Insight {
  ic: string;
  text: string;
}

export function computeInsight(
  cycleEntries: Entry[],
  settings: Settings,
  customCats: Record<IO, Category[]>,
  lang: Lang,
): Insight | null {
  const md = cycleEntries.filter((d) => d.io === 'exp');
  if (md.length < 3) return null;

  const zh = lang === 'zh';

  if (settings.budget && settings.budget > 0) {
    const exp = md.reduce((s, d) => s + d.amt, 0);
    const pct = (exp / settings.budget) * 100;
    if (pct >= 100)
      return { ic: '🥀', text: zh ? '这月预算花超了，花有点蔫了。下个月重新种 🌱' : 'Over budget this cycle — the pot wilted. Replant next month 🌱' };
    if (pct >= 80)
      return { ic: '🌼', text: zh ? `预算用了 ${Math.round(pct)}%，省着点就能让花开满。` : `${Math.round(pct)}% of budget used — ease up to keep it blooming.` };
  }

  const byCat = new Map<string, number>();
  for (const d of md) byCat.set(d.cat, (byCat.get(d.cat) ?? 0) + d.amt);

  const cb = settings.catBudgets ?? {};
  for (const k of Object.keys(cb)) {
    const spent = byCat.get(k) ?? 0;
    if (spent > cb[k]) {
      const c = catOf('exp', k, customCats);
      const name = catName(c, lang);
      return {
        ic: '🪻',
        text: zh
          ? `${name} 超出分类预算了（${Math.round(spent)}/${Math.round(cb[k])}）。`
          : `${name} is over its category budget (${Math.round(spent)}/${Math.round(cb[k])}).`,
      };
    }
  }

  const sorted = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const [topK, topAmt] = sorted[0];
  const total = md.reduce((s, d) => s + d.amt, 0);
  const topName = catName(catOf('exp', topK, customCats), lang);
  const topPct = Math.round((topAmt / total) * 100);
  return {
    ic: '🔍',
    text: zh ? `这个月 ${topName} 花得最多，占了 ${topPct}%。` : `${topName} is your biggest spend at ${topPct}%.`,
  };
}
