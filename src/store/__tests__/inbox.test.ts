import AsyncStorage from '@react-native-async-storage/async-storage';

// The native listener doesn't exist under jest; drive it by hand so the drain
// logic (auto-post vs queue, dedup, acknowledgement) can be tested end to end.
const nativeQueue: { rows: any[]; consumed: string[]; supported: boolean; enabled: boolean; capturing: boolean } = {
  rows: [], consumed: [], supported: true, enabled: true, capturing: true,
};

jest.mock('../../../modules/notif-capture', () => ({
  isSupported: () => nativeQueue.supported,
  isEnabled: () => nativeQueue.enabled,
  isCapturing: () => nativeQueue.capturing,
  getPending: async () => nativeQueue.rows,
  markConsumed: async (ids: string[]) => { nativeQueue.consumed.push(...ids); },
}));

// eslint-disable-next-line import/first -- must load after jest.mock above
import { store$ } from '../ledger';
// eslint-disable-next-line import/first -- must load after jest.mock above
import { inbox$, drainInbox, confirmPending, dismissPending } from '../inbox';

const ALIPAY = 'com.eg.android.AlipayGphone';
const T = new Date(2026, 6, 21, 12, 30).getTime();

let seq = 0;
const row = (text: string, over: Partial<{ pkg: string; title: string; postedAt: number }> = {}) => ({
  id: `q${seq++}`,
  pkg: over.pkg ?? ALIPAY,
  title: over.title ?? '支付宝',
  text,
  postedAt: over.postedAt ?? T,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  store$.data.set([]);
  store$.customCats.set({ exp: [], inc: [], xfer: [] });
  inbox$.pending.set([]);
  inbox$.unparsed.set([]);
  nativeQueue.rows = [];
  nativeQueue.consumed = [];
  nativeQueue.supported = true;
  nativeQueue.enabled = true;
  nativeQueue.capturing = true;
  seq = 0;
});

describe('drainInbox', () => {
  it('posts a capture with a merchant straight to the ledger', async () => {
    nativeQueue.rows = [row('向瑞幸咖啡付款15.90元')];
    const res = await drainInbox();

    expect(res).toMatchObject({ posted: 1, queued: 0 });
    const entries = store$.data.peek();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ io: 'exp', amt: 15.9, cat: 'food', note: '瑞幸咖啡', src: 'notif' });
  });

  it('queues a capture with no merchant instead of guessing', async () => {
    nativeQueue.rows = [row('您尾号1234的卡消费人民币35.00元', { pkg: 'com.icbc', title: '工商银行' })];
    const res = await drainInbox();

    expect(res).toMatchObject({ posted: 0, queued: 1 });
    expect(store$.data.peek()).toHaveLength(0);
    expect(inbox$.pending.peek()[0].draft).toMatchObject({ amt: 35, io: 'exp' });
  });

  // a notification says nothing about which account paid; inheriting the last
  // used one would silently corrupt balances
  it('leaves account and ledger unset on auto-posted entries', async () => {
    store$.curAccount.set('card-a');
    store$.curLedger.set('旅行');
    nativeQueue.rows = [row('向瑞幸咖啡付款15.90元')];
    await drainInbox();

    const e = store$.data.peek()[0];
    expect(e.acct).toBeUndefined();
    expect(e.ledger).toBeUndefined();
  });

  it('keeps unrecognized captures so the rules can be tuned against them', async () => {
    nativeQueue.rows = [row('本期账单已出，应还1,234.56元', { title: '花呗' })];
    const res = await drainInbox();

    expect(res).toMatchObject({ posted: 0, queued: 0, unparsed: 1 });
    expect(inbox$.unparsed.peek()[0].raw).toContain('账单已出');
  });

  it('acknowledges every row it took, parsed or not', async () => {
    nativeQueue.rows = [row('向瑞幸咖啡付款15.90元'), row('优惠券已到账', { postedAt: T + 1000 })];
    await drainInbox();
    expect(nativeQueue.consumed).toEqual(['q0', 'q1']);
  });

  it('collapses the two pushes 支付宝 sends for one payment', async () => {
    nativeQueue.rows = [
      row('向星巴克付款32.00元'),
      row('你有一笔32.00元的支出已记录', { postedAt: T + 20_000 }),
    ];
    const res = await drainInbox();
    expect(res.posted + res.queued).toBe(1);
    expect(store$.data.peek()).toHaveLength(1);
  });

  // the second push can arrive after the app was foregrounded, so within-batch
  // dedup isn't enough — the ledger itself has to be consulted
  it('does not re-post a payment already captured in an earlier drain', async () => {
    nativeQueue.rows = [row('向星巴克付款32.00元')];
    await drainInbox();
    expect(store$.data.peek()).toHaveLength(1);

    nativeQueue.rows = [row('你有一笔32.00元的支出已记录', { postedAt: T + 30_000 })];
    const res = await drainInbox();
    expect(res.posted + res.queued).toBe(0);
    expect(store$.data.peek()).toHaveLength(1);
  });

  it('does not treat a payment already waiting in the inbox as new', async () => {
    nativeQueue.rows = [row('您尾号1234的卡消费人民币35.00元', { pkg: 'com.icbc', title: '工商银行' })];
    await drainInbox();
    expect(inbox$.pending.peek()).toHaveLength(1);

    nativeQueue.rows = [row('您尾号1234的卡消费人民币35.00元', { pkg: 'com.icbc', title: '工商银行', postedAt: T + 5000 })];
    await drainInbox();
    expect(inbox$.pending.peek()).toHaveLength(1);
  });

  it('is inert when unsupported, unpermitted, or switched off', async () => {
    nativeQueue.rows = [row('向瑞幸咖啡付款15.90元')];

    nativeQueue.supported = false;
    expect(await drainInbox()).toMatchObject({ posted: 0 });
    nativeQueue.supported = true;
    nativeQueue.enabled = false;
    expect(await drainInbox()).toMatchObject({ posted: 0 });
    nativeQueue.enabled = true;
    nativeQueue.capturing = false;
    expect(await drainInbox()).toMatchObject({ posted: 0 });

    expect(store$.data.peek()).toHaveLength(0);
    expect(nativeQueue.consumed).toHaveLength(0); // nothing acknowledged either
  });
});

describe('inbox actions', () => {
  beforeEach(async () => {
    nativeQueue.rows = [row('您尾号1234的卡消费人民币35.00元', { pkg: 'com.icbc', title: '工商银行' })];
    await drainInbox();
  });

  it('confirming posts the entry and clears the item', () => {
    const id = inbox$.pending.peek()[0].id;
    confirmPending(id);
    expect(store$.data.peek()[0]).toMatchObject({ amt: 35, src: 'notif' });
    expect(inbox$.pending.peek()).toHaveLength(0);
  });

  it('confirming applies edits made on the sheet', () => {
    const id = inbox$.pending.peek()[0].id;
    confirmPending(id, { cat: 'trans', note: '加油', amt: 40 });
    expect(store$.data.peek()[0]).toMatchObject({ cat: 'trans', note: '加油', amt: 40 });
  });

  it('dismissing drops it without touching the ledger', () => {
    dismissPending(inbox$.pending.peek()[0].id);
    expect(inbox$.pending.peek()).toHaveLength(0);
    expect(store$.data.peek()).toHaveLength(0);
  });
});
