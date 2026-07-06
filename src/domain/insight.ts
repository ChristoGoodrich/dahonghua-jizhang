// Smart insight banner — ported from v7's computeInsight().
// Priority: total-budget state -> category-budget breach -> biggest category.
import type { Account, Category, Entry, IO, Settings } from './types';
import { catOf, catName } from './cats';
import { dailyStatus } from './budget';
import { dueSoon } from './statement';
import { fmtShort } from './money';
import { I18N, type Lang } from '@/i18n';

export interface Insight {
  ic: string;
  text: string;
}

/**
 * A repayment reminder for the soonest credit card with an outstanding statement
 * balance due within a week (past-due included). Returns null when nothing is
 * due — the caller falls back to the spending insight. Higher priority than
 * spending insights because it is time-sensitive money.
 */
export function creditDueInsight(
  accounts: Account[],
  entries: Entry[],
  lang: Lang,
  ref: number = Date.now(),
): Insight | null {
  const due = dueSoon(accounts, entries, ref, 7);
  if (!due.length) return null;
  const r = due[0];
  const name = lang === 'zh' ? r.account.name : r.account.nameEn || r.account.name;
  const when =
    r.daysToDue > 0 ? I18N[lang].stmtDaysLeft.replace('%d', String(r.daysToDue))
    : r.daysToDue === 0 ? I18N[lang].stmtDueToday
    : I18N[lang].stmtOverdue.replace('%d', String(-r.daysToDue));
  const amt = fmtShort(r.billedDue, lang);
  return {
    ic: '💳',
    text: lang === 'zh' ? `${name} ${when}还款，待还 ${amt}` : `${name} due ${when} · ${amt} to repay`,
  };
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

  const daily = dailyStatus(md, settings);
  if (daily.over) {
    const over = Math.round(daily.used - daily.limit);
    return { ic: '⏳', text: I18N[lang].insightDailyOver.replace('%s', String(over)) };
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
