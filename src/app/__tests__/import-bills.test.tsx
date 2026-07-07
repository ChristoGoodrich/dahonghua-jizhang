import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import ImportBillsScreen from '@/app/import-bills';
import { store$ } from '@/store/ledger';
import { I18N } from '@/i18n';

// ScreenHeader calls useRouter(); stub the router so the screen renders in isolation.
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => false }),
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

const picker = DocumentPicker as jest.Mocked<typeof DocumentPicker>;
const s = I18N.zh;

const ALIPAY = `支付宝交易记录明细查询
---------------------------------交易记录明细列表------------------------------------
交易时间,交易分类,交易对方,商品说明,收/支,金额,收/付款方式,交易状态,备注
2026-06-02 08:15:30,餐饮美食,瑞幸咖啡,标准美式,支出,15.90,余额宝,交易成功,
2026-06-03 09:00:00,,某公司,工资发放,收入,"8,000.00",余额,交易成功,月薪`;

function textOf(json: any): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (Array.isArray(json)) return json.map(textOf).join('');
  return textOf(json.children);
}

function findByLabel(r: TestRenderer.ReactTestRenderer, pred: (label: string) => boolean) {
  return r.root.findAll((n) => typeof n.props?.label === 'string' && pred(n.props.label));
}

// readFileText reads bytes via fetch().arrayBuffer() on web, then decodes.
const fetchReturning = (text: string) =>
  jest.fn(async () => ({ arrayBuffer: async () => new TextEncoder().encode(text).buffer }));

beforeAll(() => {
  (Platform as { OS: string }).OS = 'web';
  (global as { fetch?: unknown }).fetch = fetchReturning(ALIPAY);
});

beforeEach(() => {
  store$.data.set([]);
  store$.customCats.set({ exp: [], inc: [], xfer: [] });
  jest.clearAllMocks();
});

describe('ImportBillsScreen', () => {
  it('parses a picked Alipay CSV, shows the preview, and imports on confirm', async () => {
    picker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///bill.csv', name: 'bill.csv', size: 1, mimeType: 'text/csv' }],
    } as never);

    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(<ImportBillsScreen />); });

    // press "选择账单文件" → pick() runs prepareImport and sets the preview
    await act(async () => { await findByLabel(r, (l) => l === s.biPick)[0].props.onPress(); });

    const preview = textOf(r.toJSON());
    expect(preview).toContain(s.biAlipay); // detected source chip: 支付宝
    expect(preview).toContain('瑞幸咖啡'); // candidate note rendered
    expect(preview).toContain('8,000.00'); // income amount formatted

    // confirm import → entries land in the store, status shows
    expect(store$.data.peek()).toHaveLength(0);
    await act(async () => { await findByLabel(r, (l) => l.startsWith(s.biConfirm))[0].props.onPress(); });

    const live = store$.data.peek().filter((e) => !e.deletedAt);
    expect(live).toHaveLength(2);
    expect(live.find((e) => e.io === 'inc')?.amt).toBe(8000);
    expect(live.find((e) => e.io === 'exp')?.cat).toBe('food'); // 餐饮美食 → food
  });

  it('shows an error for a file with no recognizable bill header', async () => {
    (global as { fetch?: unknown }).fetch = fetchReturning('just,some\nrandom,text');
    picker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///x.csv', name: 'x.csv', size: 1, mimeType: 'text/csv' }],
    } as never);

    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(<ImportBillsScreen />); });
    await act(async () => { await findByLabel(r, (l) => l === s.biPick)[0].props.onPress(); });

    expect(textOf(r.toJSON())).toContain(s.biNoHeader);
  });
});
