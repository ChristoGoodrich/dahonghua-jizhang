import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { Entry, IO, Category } from '@/domain/types';
import type { Lang } from '@/i18n';
import { catOf, catName } from '@/domain/cats';

export interface PDFReport {
  uri: string;
  filename: string;
}

type CustomCats = Record<IO, Category[]>;

const DEFAULT_CUSTOM_CATS: CustomCats = { exp: [], inc: [], xfer: [] };

function fmtAmt(n: number): string {
  return n.toFixed(2);
}

function dateStr(ts: number, lang: Lang): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return lang === 'zh' ? `${y}年${m}月${day}日` : `${y}-${m}-${day}`;
}

function monthLabel(lang: Lang): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return lang === 'zh' ? `${y}年${m}月` : `${y}-${m}`;
}

function labels(lang: Lang) {
  return lang === 'zh'
    ? {
        title: '大红花记账',
        subtitle: '月度报表',
        exp: '花掉',
        inc: '进账',
        balance: '结余',
        entries: '笔数',
        catBreakdown: '分类明细',
        category: '分类',
        amount: '金额',
        count: '笔数',
        txList: '最近交易',
        date: '日期',
        type: '类型',
        note: '备注',
        generated: '生成时间',
        expLabel: '支出',
        incLabel: '收入',
      }
    : {
        title: 'Red Blossom',
        subtitle: 'Monthly Report',
        exp: 'Spent',
        inc: 'In',
        balance: 'Balance',
        entries: 'Entries',
        catBreakdown: 'Category Breakdown',
        category: 'Category',
        amount: 'Amount',
        count: 'Count',
        txList: 'Recent Transactions',
        date: 'Date',
        type: 'Type',
        note: 'Note',
        generated: 'Generated',
        expLabel: 'Expense',
        incLabel: 'Income',
      };
}

export function generateReportHTML(entries: Entry[], lang: Lang, customCats?: CustomCats): string {
  const cats = customCats ?? DEFAULT_CUSTOM_CATS;
  const L = labels(lang);

  const expenses = entries.filter((e) => e.io === 'exp');
  const incomes = entries.filter((e) => e.io === 'inc');
  const totalExp = expenses.reduce((s, e) => s + e.amt, 0);
  const totalInc = incomes.reduce((s, e) => s + e.amt, 0);
  const balance = totalInc - totalExp;

  // Category breakdown for expenses
  const catMap = new Map<string, { name: string; emoji: string; total: number; count: number; color: string }>();
  for (const e of expenses) {
    const cat = catOf('exp', e.cat, cats);
    const name = catName(cat, lang);
    const existing = catMap.get(cat.k);
    if (existing) {
      existing.total += e.amt;
      existing.count += 1;
    } else {
      catMap.set(cat.k, { name, emoji: cat.e, total: e.amt, count: 1, color: cat.c });
    }
  }
  const catRows = [...catMap.values()].sort((a, b) => b.total - a.total);

  // Transaction list (last 50, newest first)
  const recent = [...entries].sort((a, b) => b.ts - a.ts).slice(0, 50);

  const catTableRows = catRows
    .map(
      (c) => `
      <tr>
        <td><span class="cat-dot" style="background:${c.color}"></span>${c.emoji} ${c.name}</td>
        <td class="num">${fmtAmt(c.total)}</td>
        <td class="num">${c.count}</td>
      </tr>`,
    )
    .join('');

  const txRows = recent
    .map((e) => {
      const io = e.io === 'exp' ? L.expLabel : e.io === 'inc' ? L.incLabel : 'Transfer';
      const cat = catOf(e.io as IO, e.cat, cats);
      const catLabel = `${cat.e} ${catName(cat, lang)}`;
      return `
      <tr>
        <td>${dateStr(e.ts, lang)}</td>
        <td>${catLabel}</td>
        <td>${io}</td>
        <td class="num">${e.io === 'exp' ? '-' : ''}${fmtAmt(e.amt)}</td>
        <td>${e.note ?? ''}</td>
      </tr>`;
    })
    .join('');

  const now = new Date();
  const genTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif; color: #333; padding: 32px; background: #fff; }
  .header { text-align: center; margin-bottom: 24px; }
  .header h1 { font-size: 28px; color: #D94E5C; }
  .header h2 { font-size: 14px; color: #999; font-weight: normal; margin-top: 4px; }
  .summary { display: flex; justify-content: space-around; margin-bottom: 24px; gap: 12px; }
  .stat-card { flex: 1; background: #FFF5F5; border-radius: 12px; padding: 16px; text-align: center; }
  .stat-card .label { font-size: 12px; color: #999; margin-bottom: 4px; }
  .stat-card .value { font-size: 22px; font-weight: 700; }
  .stat-card .value.exp { color: #D94E5C; }
  .stat-card .value.inc { color: #4CAF50; }
  .stat-card .value.bal { color: #1976D2; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th { text-align: left; padding: 8px 12px; background: #F5F5F5; font-size: 12px; color: #666; border-bottom: 2px solid #EEE; }
  td { padding: 8px 12px; border-bottom: 1px solid #F0F0F0; font-size: 13px; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .section-title { font-size: 16px; font-weight: 600; color: #D94E5C; margin: 24px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #F5D0D5; }
  .cat-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
  .footer { text-align: center; font-size: 11px; color: #BBB; margin-top: 32px; padding-top: 16px; border-top: 1px solid #EEE; }
</style>
</head>
<body>
  <div class="header">
    <h1>🌺 ${L.title}</h1>
    <h2>${L.subtitle} · ${monthLabel(lang)}</h2>
  </div>

  <div class="summary">
    <div class="stat-card">
      <div class="label">${L.exp}</div>
      <div class="value exp">${fmtAmt(totalExp)}</div>
    </div>
    <div class="stat-card">
      <div class="label">${L.inc}</div>
      <div class="value inc">${fmtAmt(totalInc)}</div>
    </div>
    <div class="stat-card">
      <div class="label">${L.balance}</div>
      <div class="value bal">${fmtAmt(balance)}</div>
    </div>
    <div class="stat-card">
      <div class="label">${L.entries}</div>
      <div class="value">${entries.length}</div>
    </div>
  </div>

  <div class="section-title">${L.catBreakdown}</div>
  <table>
    <thead><tr><th>${L.category}</th><th style="text-align:right">${L.amount}</th><th style="text-align:right">${L.count}</th></tr></thead>
    <tbody>${catTableRows || '<tr><td colspan="3" style="text-align:center;color:#999">-</td></tr>'}</tbody>
  </table>

  <div class="section-title">${L.txList}</div>
  <table>
    <thead><tr><th>${L.date}</th><th>${L.category}</th><th>${L.type}</th><th style="text-align:right">${L.amount}</th><th>${L.note}</th></tr></thead>
    <tbody>${txRows || '<tr><td colspan="5" style="text-align:center;color:#999">-</td></tr>'}</tbody>
  </table>

  <div class="footer">${L.generated}: ${genTime} · 🌺 大红花记账</div>
</body>
</html>`;
}

export async function generateMonthlyReport(entries: Entry[], lang: Lang, customCats?: CustomCats): Promise<PDFReport> {
  const html = generateReportHTML(entries, lang, customCats);
  const { uri } = await Print.printToFileAsync({ html });
  const month = monthLabel(lang).replace(/[年月]/g, '-').replace(/-$/, '');
  const filename = `report_${month}.pdf`;
  return { uri, filename };
}

export async function shareReport(report: PDFReport): Promise<void> {
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(report.uri, { mimeType: 'application/pdf' });
  }
}
