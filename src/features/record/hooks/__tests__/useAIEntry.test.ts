// useAIEntry holds no state of its own — it is a factory over injected setters,
// so it can be exercised by calling it directly, no renderer involved. That is
// the whole point of the split from useRecordForm, and it means the two async
// paths users actually hit (quick-entry text, receipt photo) can be pinned down
// including every failure branch.

import { useAIEntry } from '../useAIEntry';
import { I18N } from '@/i18n';

const mockParseEntryText = jest.fn();
const mockParseReceiptImage = jest.fn();

class MockReceiptError extends Error {}

jest.mock('@/ai/client', () => ({
  parseEntryText: (...a: unknown[]) => mockParseEntryText(...a),
}));

jest.mock('@/ai/receipt', () => ({
  parseReceiptImage: (...a: unknown[]) => mockParseReceiptImage(...a),
  get ReceiptError() {
    return MockReceiptError;
  },
}));

const mockShareCats = { value: undefined as boolean | undefined };

jest.mock('@/store/ledger', () => ({
  store$: { settings: { aiShareCategories: { peek: () => mockShareCats.value } } },
}));

const s = I18N.zh;
const CATS = { exp: [], inc: [], xfer: [] } as never;

// named `use…` so react-hooks/rules-of-hooks accepts the call below: useAIEntry
// is hook-named but calls no React hooks, which is exactly why it is testable here
function useDeps(aiText = '午饭35') {
  const spies = {
    setAiText: jest.fn(), setAiBusy: jest.fn(), setAiMsg: jest.fn(),
    setIO: jest.fn(), setCat: jest.fn(), setAmt: jest.fn(), setNote: jest.fn(), setTs: jest.fn(),
    setFlash: jest.fn(), setReceiptUri: jest.fn(), setReceiptBusy: jest.fn(),
  };
  const hook = useAIEntry({ aiText, customCats: CATS, lang: 'zh', s, ...spies } as never);
  return { ...spies, ...hook };
}

beforeEach(() => {
  mockParseEntryText.mockReset();
  mockParseReceiptImage.mockReset();
  mockShareCats.value = undefined;
});

describe('runAI', () => {
  it('does nothing at all for blank input', async () => {
    const d = useDeps('   ');
    await d.runAI();
    expect(mockParseEntryText).not.toHaveBeenCalled();
    expect(d.setAiBusy).not.toHaveBeenCalled();
  });

  it('fills the form from a draft and clears the prompt', async () => {
    mockParseEntryText.mockResolvedValue({ io: 'exp', cat: 'food', amt: '35', note: '午饭' });
    const d = useDeps();
    await d.runAI();

    expect(d.setIO).toHaveBeenCalledWith('exp');
    expect(d.setCat).toHaveBeenCalledWith('food');
    expect(d.setAmt).toHaveBeenCalledWith('35');
    expect(d.setNote).toHaveBeenCalledWith('午饭');
    expect(d.setAiText).toHaveBeenCalledWith('');
    expect(d.setAiMsg).toHaveBeenCalledWith(''); // cleared, never set to an error
    expect(d.setAiMsg).not.toHaveBeenCalledWith(s.aiFailed);
  });

  it('trims the prompt before sending it', async () => {
    mockParseEntryText.mockResolvedValue({ io: 'exp', cat: 'food', amt: '35' });
    await useDeps('  午饭35  ').runAI();
    expect(mockParseEntryText).toHaveBeenCalledWith('午饭35', CATS, 'zh', true);
  });

  it('defaults category sharing to on, and honours an explicit opt-out', async () => {
    mockParseEntryText.mockResolvedValue({ io: 'exp', cat: 'food', amt: '1' });

    await useDeps().runAI();
    expect(mockParseEntryText.mock.calls[0][3]).toBe(true);

    mockShareCats.value = false;
    await useDeps().runAI();
    expect(mockParseEntryText.mock.calls[1][3]).toBe(false);

    mockShareCats.value = true;
    await useDeps().runAI();
    expect(mockParseEntryText.mock.calls[2][3]).toBe(true);
  });

  it('resolves a returned ISO date to local noon', async () => {
    mockParseEntryText.mockResolvedValue({ io: 'exp', cat: 'food', amt: '35', date: '2026-03-04' });
    const d = useDeps();
    await d.runAI();

    const ts = d.setTs.mock.calls[0][0] as number;
    const at = new Date(ts);
    expect(at.getFullYear()).toBe(2026);
    expect(at.getMonth()).toBe(2); // March
    expect(at.getDate()).toBe(4);
    expect(at.getHours()).toBe(12); // noon, so a timezone shift cannot move the day
  });

  it('leaves note and date alone when the model omits them', async () => {
    mockParseEntryText.mockResolvedValue({ io: 'inc', cat: 'salary', amt: '900', note: '' });
    const d = useDeps();
    await d.runAI();
    expect(d.setNote).not.toHaveBeenCalled();
    expect(d.setTs).not.toHaveBeenCalled();
  });

  it('reports "unconfigured" when the client returns null', async () => {
    mockParseEntryText.mockResolvedValue(null);
    const d = useDeps();
    await d.runAI();
    expect(d.setAiMsg).toHaveBeenLastCalledWith(s.aiUnconfigured);
    expect(d.setAmt).not.toHaveBeenCalled();
  });

  it('reports failure when the draft carries no amount', async () => {
    mockParseEntryText.mockResolvedValue({ io: 'exp', cat: 'food', amt: '' });
    const d = useDeps();
    await d.runAI();
    expect(d.setAiMsg).toHaveBeenLastCalledWith(s.aiFailed);
    expect(d.setAmt).not.toHaveBeenCalled();
  });

  it('reports failure when the client throws', async () => {
    mockParseEntryText.mockRejectedValue(new Error('network'));
    const d = useDeps();
    await d.runAI();
    expect(d.setAiMsg).toHaveBeenLastCalledWith(s.aiFailed);
  });

  it('always releases the busy flag', async () => {
    mockParseEntryText.mockRejectedValue(new Error('network'));
    const d = useDeps();
    await d.runAI();
    expect(d.setAiBusy).toHaveBeenNthCalledWith(1, true);
    expect(d.setAiBusy).toHaveBeenLastCalledWith(false);
  });
});

describe('handleReceiptCapture', () => {
  const URI = 'file:///receipt.jpg';

  it('shows the photo immediately, before the model has answered', async () => {
    mockParseReceiptImage.mockResolvedValue({ io: 'exp', cat: 'food', amt: '88' });
    const d = useDeps();
    await d.handleReceiptCapture(URI);
    expect(d.setReceiptUri).toHaveBeenCalledWith(URI);
    expect(d.setFlash).toHaveBeenCalledWith(null); // stale error cleared first
  });

  it('fills the form from the receipt', async () => {
    mockParseReceiptImage.mockResolvedValue({ io: 'exp', cat: 'food', amt: '88', note: '肯德基' });
    const d = useDeps();
    await d.handleReceiptCapture(URI);
    expect(d.setIO).toHaveBeenCalledWith('exp');
    expect(d.setAmt).toHaveBeenCalledWith('88');
    expect(d.setNote).toHaveBeenCalledWith('肯德基');
  });

  it('applies a date printed on the receipt at local noon', async () => {
    mockParseReceiptImage.mockResolvedValue({ io: 'exp', cat: 'food', amt: '88', date: '2025-12-31' });
    const d = useDeps();
    await d.handleReceiptCapture(URI);
    const at = new Date(d.setTs.mock.calls[0][0] as number);
    expect(at.getFullYear()).toBe(2025);
    expect(at.getMonth()).toBe(11);
    expect(at.getDate()).toBe(31);
    expect(at.getHours()).toBe(12);
  });

  it('flashes a failure when the receipt yields nothing', async () => {
    mockParseReceiptImage.mockResolvedValue(null);
    const d = useDeps();
    await d.handleReceiptCapture(URI);
    expect(d.setFlash).toHaveBeenLastCalledWith({ msg: s.aiFailed, err: true });
    expect(d.setAmt).not.toHaveBeenCalled();
  });

  it('flashes a failure when the receipt has no readable total', async () => {
    mockParseReceiptImage.mockResolvedValue({ io: 'exp', cat: 'food', amt: '' });
    const d = useDeps();
    await d.handleReceiptCapture(URI);
    expect(d.setFlash).toHaveBeenLastCalledWith({ msg: s.aiFailed, err: true });
  });

  it('distinguishes a ReceiptError from a permission problem', async () => {
    mockParseReceiptImage.mockRejectedValue(new MockReceiptError('status 429'));
    const d1 = useDeps();
    await d1.handleReceiptCapture(URI);
    expect(d1.setFlash).toHaveBeenLastCalledWith({ msg: s.aiFailed, err: true });

    mockParseReceiptImage.mockRejectedValue(new Error('camera denied'));
    const d2 = useDeps();
    await d2.handleReceiptCapture(URI);
    expect(d2.setFlash).toHaveBeenLastCalledWith({ msg: s.cameraPermissionDesc, err: true });
  });

  it('always releases the busy flag', async () => {
    mockParseReceiptImage.mockRejectedValue(new Error('boom'));
    const d = useDeps();
    await d.handleReceiptCapture(URI);
    expect(d.setReceiptBusy).toHaveBeenNthCalledWith(1, true);
    expect(d.setReceiptBusy).toHaveBeenLastCalledWith(false);
  });
});
