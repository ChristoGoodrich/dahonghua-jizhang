import { receiptAiConfigured, ReceiptError, parseReceiptImage } from '../receipt';

describe('receiptAiConfigured', () => {
  it('returns a boolean', () => {
    expect(typeof receiptAiConfigured()).toBe('boolean');
  });
});

describe('ReceiptError', () => {
  it('is an instance of Error', () => {
    const err = new ReceiptError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('test');
  });
});

describe('parseReceiptImage', () => {
  it('returns null when AI is not configured', async () => {
    // If EXPO_PUBLIC_MIMO_API_KEY is not set, should return null
    if (!receiptAiConfigured()) {
      const result = await parseReceiptImage('file:///test.jpg', { exp: [], inc: [], xfer: [] }, 'zh');
      expect(result).toBeNull();
    }
  });
});
