import { pickerAccounts, archivedAccounts, pickerLedgers, archivedLedgers } from '../archive';
import type { Account } from '../types';

const A = (id: string, archived?: boolean): Account => ({ id, name: id, balance: 0, archived });

describe('pickerAccounts', () => {
  const accts = [A('cash'), A('oldcard', true), A('bank'), A('gift', true)];

  it('hides archived accounts by default, keeping order', () => {
    expect(pickerAccounts(accts).map((a) => a.id)).toEqual(['cash', 'bank']);
  });

  it('keeps a selected archived account visible (editing an old entry)', () => {
    expect(pickerAccounts(accts, ['oldcard']).map((a) => a.id)).toEqual(['cash', 'oldcard', 'bank']);
    // transfer: both legs selected, one active one archived
    expect(pickerAccounts(accts, ['bank', 'gift']).map((a) => a.id)).toEqual(['cash', 'bank', 'gift']);
  });

  it('ignores undefined/empty keep ids', () => {
    expect(pickerAccounts(accts, [undefined, '']).map((a) => a.id)).toEqual(['cash', 'bank']);
  });
});

describe('archivedAccounts', () => {
  it('returns only archived, in order', () => {
    const accts = [A('cash'), A('oldcard', true), A('gift', true)];
    expect(archivedAccounts(accts).map((a) => a.id)).toEqual(['oldcard', 'gift']);
  });
});

describe('pickerLedgers / archivedLedgers', () => {
  const ledgers = ['日常', '日本行', '装修', '欧洲行'];
  const archived = ['日本行', '欧洲行'];

  it('pickerLedgers hides archived unless it is the applied filter', () => {
    expect(pickerLedgers(ledgers, archived)).toEqual(['日常', '装修']);
    expect(pickerLedgers(ledgers, archived, '日本行')).toEqual(['日常', '日本行', '装修']);
  });

  it('pickerLedgers with no archive list returns everything', () => {
    expect(pickerLedgers(ledgers)).toEqual(ledgers);
  });

  it('archivedLedgers returns only archived, in original order', () => {
    expect(archivedLedgers(ledgers, archived)).toEqual(['日本行', '欧洲行']);
  });
});
