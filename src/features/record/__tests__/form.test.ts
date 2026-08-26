import {
  validate, rateSource, initialFields, pickIo, shouldPatchTs, draft, afterSaveNext,
  type FormFields,
} from '../form';
import type { Currencies, Entry } from '@/domain/types';

const CNY: Currencies = { base: 'CNY', rates: { USD: 7.2, JPY: 0.048 } };

const form = (over: Partial<FormFields> = {}): FormFields => ({
  io: 'exp', cat: 'food', amt: '30', note: '', acct: 'default', acctTo: '',
  fee: '', discount: '', tags: [], ledger: '', cur: 'CNY', subcat: '', ts: null,
  ...over,
});

describe('validate', () => {
  it('accepts a plain expense', () => {
    expect(validate(form(), 'CNY', CNY.rates)).toBeNull();
  });

  it('refuses an amount that is empty, zero, or negative', () => {
    for (const amt of ['', '0', '0.00', '5-9', '5-5']) {
      expect(validate(form({ amt }), 'CNY', CNY.rates)).toEqual({ kind: 'amount' });
    }
  });

  it('refuses a transfer with no destination, or the same one twice', () => {
    expect(validate(form({ io: 'xfer' }), 'CNY', CNY.rates)).toEqual({ kind: 'xferTo' });
    expect(validate(form({ io: 'xfer', acctTo: 'default' }), 'CNY', CNY.rates))
      .toEqual({ kind: 'xferSame' });
    expect(validate(form({ io: 'xfer', acctTo: 'cash' }), 'CNY', CNY.rates)).toBeNull();
  });

  it('refuses a foreign currency with no rate, and names it', () => {
    expect(validate(form({ cur: 'EUR' }), 'CNY', CNY.rates)).toEqual({ kind: 'noRate', cur: 'EUR' });
    expect(validate(form({ cur: 'USD' }), 'CNY', CNY.rates)).toBeNull();
  });

  it('checks the amount before anything else', () => {
    // a form that is wrong in two ways names the amount, because that is the
    // field the user is looking at
    expect(validate(form({ amt: '', io: 'xfer' }), 'CNY', CNY.rates)).toEqual({ kind: 'amount' });
  });
});

describe('rateSource', () => {
  it('is nothing when no rate was fetched', () => {
    expect(rateSource(null, 7.2)).toBeNull();
  });

  it('reads a fetched rate as the cached one within a tolerance', () => {
    // the same number through a JSON round trip is not obliged to come back
    // as the same double
    expect(rateSource(7.2, 7.2)).toBe('cached');
    expect(rateSource(7.2000001, 7.2)).toBe('cached');
    expect(rateSource(7.21, 7.2)).toBe('api');
  });

  it('is the api when there is nothing cached to match', () => {
    expect(rateSource(7.2, undefined)).toBe('api');
  });
});

describe('initialFields', () => {
  const defaults = {
    base: 'CNY', acct: 'card-a', ledger: 'home', firstExpCat: 'food', initialTs: null,
  };
  const src: Entry = {
    id: 's', ts: 1000, io: 'inc', cat: 'salary', amt: 72,
    cur: 'USD', origAmt: 10, note: 'pay', acct: 'bank', fee: 0, tags: ['work'],
  };

  it('opens a fresh form on the defaults', () => {
    const f = initialFields(undefined, false, defaults);
    expect(f).toMatchObject({ io: 'exp', cat: 'food', amt: '', acct: 'card-a', ledger: 'home', cur: 'CNY' });
  });

  it('takes a pre-picked date for a new entry', () => {
    expect(initialFields(undefined, false, { ...defaults, initialTs: 5000 }).ts).toBe(5000);
  });

  it('shows the original foreign amount when editing, not the converted one', () => {
    // an entry recorded as $10 shows 10, not 72
    expect(initialFields(src, true, defaults).amt).toBe('10');
  });

  it('keeps the date when editing and drops it when duplicating', () => {
    expect(initialFields(src, true, defaults).ts).toBe(1000);
    expect(initialFields(src, false, defaults).ts).toBeNull(); // 再记一笔 lands today
  });

  it('shows a zero fee as an empty field, not as "0"', () => {
    expect(initialFields(src, true, defaults).fee).toBe('');
    expect(initialFields({ ...src, fee: 2 }, true, defaults).fee).toBe('2');
  });

  it('falls back to the base currency when the source names none', () => {
    const { cur } = initialFields({ ...src, cur: undefined }, true, defaults);
    expect(cur).toBe('CNY');
  });
});

describe('pickIo', () => {
  it('clears the subcategory whichever direction is picked', () => {
    expect(pickIo('inc', form({ subcat: 'x' }), [], 'default', () => 'salary').subcat).toBe('');
    expect(pickIo('xfer', form({ subcat: 'x' }), [], 'default', () => '').subcat).toBe('');
  });

  it('resets the category to the first of the new direction', () => {
    expect(pickIo('inc', form(), ['default'], 'default', (io) => `first-${io}`).cat).toBe('first-inc');
  });

  it('picks a different account as the transfer destination', () => {
    const p = pickIo('xfer', form({ acct: 'a' }), ['a', 'b', 'c'], 'a', () => '');
    expect(p.acct).toBe('a');
    expect(p.acctTo).toBe('b');
  });

  it('leaves the destination empty when there is no other account', () => {
    // which validate then refuses, rather than transferring to nowhere
    const p = pickIo('xfer', form({ acct: 'a' }), ['a'], 'a', () => '');
    expect(p.acctTo).toBe('');
  });

  it('falls back to the current account when the form names none', () => {
    const p = pickIo('xfer', form({ acct: '' }), ['cur', 'b'], 'cur', () => '');
    expect(p.acct).toBe('cur');
  });
});

describe('shouldPatchTs', () => {
  it('writes the date only when it actually changed', () => {
    expect(shouldPatchTs(1000, 2000)).toBe(true);
    expect(shouldPatchTs(1000, 1000)).toBe(false);
  });

  it('does not write it for a new entry, or an untouched form', () => {
    expect(shouldPatchTs(undefined, 2000)).toBe(false); // nothing to compare against
    expect(shouldPatchTs(1000, null)).toBe(false); // the form never set one
  });
});

describe('draft', () => {
  it('evaluates the expression rather than parsing a number', () => {
    expect(draft(form({ amt: '12+8' }), 'CNY', CNY)).toMatchObject({ amt: 20 });
  });

  it('refuses what validate refuses', () => {
    expect(draft(form({ amt: '0' }), 'CNY', CNY)).toBeNull();
    expect(draft(form({ io: 'xfer', acctTo: '' }), 'CNY', CNY)).toBeNull();
    expect(draft(form({ io: 'xfer', acct: 'a', acctTo: 'a' }), 'CNY', CNY)).toBeNull();
  });

  it('persists a foreign amount in the base currency, keeping the original', () => {
    const d = draft(form({ cur: 'USD', amt: '10' }), 'CNY', CNY);
    expect(d).toMatchObject({ amt: 72, origAmt: 10, cur: 'USD', rate: 7.2 });
  });

  it('leaves the currency fields off an entry in the base currency', () => {
    const d = draft(form({ cur: 'CNY' }), 'CNY', CNY) as Extract<typeof d, { kind: 'entry' }>;
    expect(d.cur).toBeUndefined();
    expect(d.origAmt).toBeUndefined();
    expect(d.rate).toBeUndefined();
  });

  it('takes an override rate over the cached one', () => {
    const d = draft(form({ cur: 'USD', amt: '10' }), 'CNY', CNY, 7.5);
    expect(d).toMatchObject({ rate: 7.5, amt: 75 });
  });

  it('trims the note, and drops the empty optionals', () => {
    const d = draft(form({ note: '  午饭  ' }), 'CNY', CNY) as Extract<typeof d, { kind: 'entry' }>;
    expect(d.note).toBe('午饭');
    expect(d.tags).toBeUndefined();
    expect(d.ledger).toBeUndefined();
    expect(d.subcat).toBeUndefined();
  });

  it('reads an unparseable fee as zero rather than as NaN', () => {
    const d = draft(form({ io: 'xfer', acctTo: 'b', fee: '', discount: 'abc' }), 'CNY', CNY);
    expect(d).toMatchObject({ kind: 'xfer', fee: 0, discount: 0 });
  });
});

describe('afterSaveNext', () => {
  it('keeps what "the same kind" means, and clears the entry itself', () => {
    const f = form({
      io: 'inc', cat: 'salary', acct: 'bank', cur: 'USD', ts: 5000,
      tags: ['work'], ledger: 'home', amt: '45', note: 'a', subcat: 'b', fee: '1', discount: '2',
    });
    const next = afterSaveNext(f);
    expect(next).toMatchObject({
      io: 'inc', cat: 'salary', acct: 'bank', cur: 'USD', ts: 5000, tags: ['work'], ledger: 'home',
    });
    expect(next).toMatchObject({ amt: '', note: '', subcat: '', fee: '', discount: '' });
  });
});
