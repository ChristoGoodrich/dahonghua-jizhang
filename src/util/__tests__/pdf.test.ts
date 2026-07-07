import { generateReportHTML, generateMonthlyReport, shareReport } from '../pdf';
import type { Entry, Category } from '@/domain/types';

const sampleEntries: Entry[] = [
  { id: '1', ts: new Date(2025, 0, 15).getTime(), io: 'exp', cat: 'food', amt: 35, note: 'Lunch' },
  { id: '2', ts: new Date(2025, 0, 16).getTime(), io: 'exp', cat: 'shop', amt: 200, note: 'Shoes' },
  { id: '3', ts: new Date(2025, 0, 17).getTime(), io: 'inc', cat: 'salary', amt: 5000, note: 'January salary' },
  { id: '4', ts: new Date(2025, 0, 18).getTime(), io: 'exp', cat: 'food', amt: 50, note: 'Dinner' },
];

describe('generateReportHTML', () => {
  it('returns HTML with correct structure', () => {
    const html = generateReportHTML(sampleEntries, 'zh');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
    expect(html).toContain('大红花记账');
  });

  it('calculates totals correctly', () => {
    const html = generateReportHTML(sampleEntries, 'zh');
    // Total expense: 35 + 200 + 50 = 285
    expect(html).toContain('285');
    // Total income: 5000
    expect(html).toContain('5000');
    // Balance: 5000 - 285 = 4715
    expect(html).toContain('4715');
  });

  it('supports English language', () => {
    const html = generateReportHTML(sampleEntries, 'en');
    expect(html).toContain('Red Blossom');
    expect(html).toContain('Expense');
    expect(html).toContain('Income');
    expect(html).toContain('Balance');
  });

  it('supports Chinese language', () => {
    const html = generateReportHTML(sampleEntries, 'zh');
    expect(html).toContain('大红花记账');
    expect(html).toContain('花掉');
    expect(html).toContain('进账');
    expect(html).toContain('结余');
  });

  it('includes category breakdown', () => {
    const html = generateReportHTML(sampleEntries, 'zh');
    expect(html).toContain('餐饮');
    expect(html).toContain('购物');
  });

  it('handles empty entries', () => {
    const html = generateReportHTML([], 'zh');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('0');
  });

  it('accepts custom categories', () => {
    const customCats: Record<string, Category[]> = {
      exp: [{ k: 'coffee', e: '☕', zh: '咖啡', en: 'Coffee', c: '#8B4513' }],
      inc: [],
      xfer: [],
    };
    const entries: Entry[] = [
      { id: '1', ts: Date.now(), io: 'exp', cat: 'coffee', amt: 25, note: 'Latte' },
    ];
    const html = generateReportHTML(entries, 'zh', customCats);
    expect(html).toContain('咖啡');
  });
});

describe('generateMonthlyReport', () => {
  it('returns a PDFReport with uri and filename', async () => {
    const report = await generateMonthlyReport(sampleEntries, 'zh');
    expect(report).toHaveProperty('uri');
    expect(report).toHaveProperty('filename');
    expect(report.uri).toContain('file://');
    expect(report.filename).toContain('.pdf');
  });
});

describe('shareReport', () => {
  it('resolves without error', async () => {
    const report = await generateMonthlyReport(sampleEntries, 'zh');
    await expect(shareReport(report)).resolves.toBeUndefined();
  });
});
