// TypeScript half of the *stateful* parity harness.
//
// The pure modules compare a function's answer to one input. A ledger has no
// single answer — it has a history — so this replays a command sequence and
// compares the ledger it leaves behind.
//
// Three things have to be pinned for that comparison to mean anything:
//
//   * **The clock.** addEntry/updateEntry/removeEntry all call Date.now()
//     internally. Mocked here so a sequence is reproducible; the Rust side
//     takes `now` as an argument, which is the same pinning done properly.
//   * **Identity.** newId() mixes a clock, a counter and Math.random(). Rather
//     than trying to reproduce that in Rust — id generation is a platform
//     concern, not ledger logic — ids are normalised to insertion order (e0,
//     e1, …) on both sides, references included.
//   * **The store.** This runs under jest.parity.config.js because state.ts
//     imports AsyncStorage. It is not part of `npm test`.
//
// It is written as a jest test purely to get those module mocks; it asserts
// nothing itself. `npm run parity` diffs its output against the Rust dump.

import * as fs from 'fs';
import type { Account, Asset, Entry, Loan, Sub, Template } from '@/domain/types';

const IN = process.env.PARITY_IN as string;
const OUT = process.env.PARITY_OUT as string;

/** Fields compared, in a fixed order. Anything absent renders as `_`. */
const FIELDS = [
  'ts', 'io', 'cat', 'amt', 'refund', 'refundOf', 'acct', 'acctTo',
  'cur', 'origAmt', 'fee', 'discount', 'rb', 'rbAmt', 'deletedAt', 'updatedAt',
] as const;

function render(entries: Entry[], idOf: Map<string, string>, acctNames: Map<string, string>): string {
  return entries
    .map((e) => {
      const cells = FIELDS.map((f) => {
        const v = e[f as keyof Entry];
        if (v === undefined || v === null) return '_';
        if (f === 'refundOf') return idOf.get(String(v)) ?? String(v);
      if (f === 'acct' || f === 'acctTo') return acctNames.get(String(v)) ?? String(v);
        return String(v);
      });
      const ft = Object.keys(e.fieldTs ?? {})
        .sort()
        .map((k) => `${k}=${e.fieldTs![k]}`)
        .join(';');
      return [idOf.get(e.id) ?? e.id, ...cells, ft || '_'].join(',');
    })
    .join(' | ');
}

function renderAccounts(accounts: Account[], current: string, acctName: Map<string, string>): string {
  const list = accounts
    .map((a) => `${acctName.get(a.id) ?? a.id}:${a.kind ?? '_'}:${a.archived ?? '_'}`)
    .join(' ');
  return `[${list}] cur=${acctName.get(current) ?? current}`;
}

const n2 = (v: number | undefined) => (v === undefined || v === null ? '_' : String(v));

function renderCatalog(store: typeof import('@/store/ledger'), tplName: Map<string, string>): string {
  const st = store.store$.settings.peek();
  const tags = store.store$.tags.peek();
  const subcats = store.store$.subcats.peek();
  const cats = store.store$.customCats.peek();
  const all = [...(cats.exp ?? []), ...(cats.inc ?? []), ...(cats.xfer ?? [])];
  return (
    `tg[${(tags.normal ?? []).join(',')}|${(tags.ledger ?? []).join(',')}] ` +
    `arch[${st.archivedLedgers ? st.archivedLedgers.join(',') : '_'}] ` +
    `led=${store.store$.curLedger.peek() || '_'} ` +
    `ct[${all.map((c) => `${c.k}:${c.e}:${c.c}`).join(',')}] ` +
    // Sorted, because the Rust side keys subcats by a BTreeMap while a JS
    // object preserves insertion order. Nothing reads these across categories —
    // they are a lookup keyed by category — so the ordering is representation,
    // not behaviour, and normalising it keeps the comparison about content.
    `sc[${Object.entries(subcats)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${(v as { k: string; name: string }[]).map((x, i) => `sc${i}:${x.name}`).join('+')}`)
      .join(';')}] ` +
    `tpl[${store.store$.templates.peek().map((t: Template) => `${tplName.get(t.id) ?? t.id}:${t.amt}`).join(',')}]`
  );
}

function renderMoney(store: typeof import('@/store/ledger')): string {
  const st = store.store$.settings.peek();
  const c = store.store$.currencies.peek();
  const rates = Object.entries(c.rates ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join(';');
  const cat = st.catBudgets
    ? Object.entries(st.catBudgets).map(([k, v]) => `${k}:${v}`).join(';')
    : '_';
  return (
    `as[${store.store$.assets.peek().map((a: Asset) => a.val).join(',')}] ` +
    `ln[${store.store$.loans.peek().map((l: Loan) => `${l.amt}/${n2(l.repaid)}`).join(',')}] ` +
    `sb[${store.store$.subs.peek().map((s: Sub) => s.amt).join(',')}] ` +
    `tp[${store.store$.templates.peek().map((t: Template) => t.amt).join(',')}] ` +
    `bg[${st.budget},${n2(st.dailyBudget)},${n2(st.weeklyBudget)},${cat}] ` +
    `cur[${c.base} ${rates}]`
  );
}

/** One `verb:args` step. */
function runScenario(script: string): string {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  // ledger.ts re-exports state.ts plus every per-domain action module, so one
  // require keeps them all on the same store instance after resetModules()
  const store = require('@/store/ledger') as typeof import('@/store/ledger');
  store.store$.data.set([]);

  let clock = 1_000_000;
  const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock);

  /** insertion order → stable name, and back */
  const idOf = new Map<string, string>();
  const byName = new Map<string, string>();
  let seq = 0;
  const undos: ReturnType<typeof store.removeEntry>[] = [];
  // accounts get the same insertion-order naming as entries; 'default' is the
  // seed both sides start from
  const acctName = new Map<string, string>([['default', 'default']]);
  const acctByName = new Map<string, string>([['default', 'default']]);
  let acctSeq = 0;
  store.store$.accounts.set([{ id: 'default', name: '默认', nameEn: 'Default', balance: 0 }]);
  store.store$.curAccount.set('default');
  store.store$.assets.set([]);
  store.store$.loans.set([]);
  store.store$.subs.set([]);
  store.store$.templates.set([]);
  store.store$.currencies.set({ base: 'CNY', rates: {} });
  store.store$.settings.assign({
    budget: 0, dailyBudget: undefined, weeklyBudget: undefined, catBudgets: undefined,
  });
  const baseResults: string[] = [];
  const refunds: string[] = [];
  // assets and loans get real generated ids here; the corpus addresses them by
  // insertion order, exactly as entries, accounts and templates already do
  const assetByName = new Map<string, string>();
  const loanByName = new Map<string, string>();
  let assetSeq = 0;
  let loanSeq = 0;
  const tplName = new Map<string, string>();
  const tplByName = new Map<string, string>();
  let tplSeq = 0;
  store.store$.tags.set({ normal: [], ledger: [] });
  store.store$.curLedger.set('');
  store.store$.customCats.set({ exp: [], inc: [], xfer: [] });
  store.store$.subcats.set({});
  store.store$.settings.assign({ archivedLedgers: undefined });

  const name = (realId: string) => {
    const n = `e${seq++}`;
    idOf.set(realId, n);
    byName.set(n, realId);
    return n;
  };

  for (const step of script.split('|')) {
    const [verb, rawArgs = ''] = step.split(':');
    const args = rawArgs ? rawArgs.split(',') : [];
    clock += 10; // every command lands at a distinct, predictable time

    switch (verb) {
      case 'add': {
        const [ts, io, cat, amt, refundOf, refund, acct, acctTo, cur, origAmt] = args;
        const e = store.addEntry({
          ts: Number(ts),
          io: io as Entry['io'],
          cat,
          amt: Number(amt),
          ...(refundOf ? { refundOf: byName.get(refundOf) ?? refundOf } : {}),
          ...(refund ? { refund: Number(refund) } : {}),
          ...(acct ? { acct: acctByName.get(acct) ?? acct } : {}),
          ...(acctTo ? { acctTo: acctByName.get(acctTo) ?? acctTo } : {}),
          ...(cur ? { cur } : {}),
          ...(origAmt ? { origAmt: Number(origAmt) } : {}),
        });
        name(e.id);
        break;
      }
      case 'acct': {
        const [kind, statementDay, dueDay, fxCode] = args;
        const a = store.addAccount(`户${acctSeq + 1}`, 0, kind as Account['kind'], {
          ...(statementDay ? { statementDay: Number(statementDay) } : {}),
          ...(dueDay ? { dueDay: Number(dueDay) } : {}),
          ...(fxCode ? { fxCode } : {}),
        });
        const n = `a${acctSeq++}`;
        acctName.set(a.id, n);
        acctByName.set(n, a.id);
        break;
      }
      case 'rmacct':
        store.removeAccount(acctByName.get(args[0]) ?? args[0]);
        break;
      case 'arch':
        store.archiveAccount(acctByName.get(args[0]) ?? args[0], args[1] === '1');
        break;
      case 'sel':
        store.store$.curAccount.set(acctByName.get(args[0]) ?? args[0]);
        break;

      // --- net worth ---
      case 'asset2': {
        const a = store.addAsset('x', args[0] as 'asset' | 'liab', Number(args[1]));
        assetByName.set(`as${assetSeq++}`, a.id);
        break;
      }
      case 'rmasset':
        store.removeAsset(assetByName.get(args[0]) ?? args[0]);
        break;
      case 'loan2': {
        const l = store.addLoan('x', args[0] as 'lend' | 'borrow', Number(args[1]));
        loanByName.set(`l${loanSeq++}`, l.id);
        break;
      }
      case 'repay':
        store.repayLoan(loanByName.get(args[0]) ?? args[0], Number(args[1]));
        break;
      case 'rmloan':
        store.removeLoan(loanByName.get(args[0]) ?? args[0]);
        break;

      // --- reimbursement ---
      case 'rbtog':
        store.toggleReimburse(byName.get(args[0]) ?? args[0]);
        break;
      case 'rbdone':
        store.confirmReimburse(byName.get(args[0]) ?? args[0]);
        break;
      case 'rbclear':
        store.unmarkReimburse(byName.get(args[0]) ?? args[0]);
        break;
      case 'refund': {
        const before = store.store$.data.peek().length;
        const got = store.refundEntry(
          byName.get(args[0]) ?? args[0],
          Number(args[1]),
          (args[2] ?? 'zh') as 'zh' | 'en',
        );
        // the linked income is appended; give it the next stable name
        const after = store.store$.data.peek();
        if (after.length > before) name(after[after.length - 1].id);
        refunds.push(String(got));
        break;
      }

      // --- catalogue ---
      case 'tag':
        store.addTag(args[0] as 'normal' | 'ledger', args[1]);
        break;
      case 'rmtag':
        store.removeTag(args[0] as 'normal' | 'ledger', args[1]);
        break;
      case 'curled':
        store.setCurLedger(args[0]);
        break;
      case 'archled':
        store.archiveLedger(args[0], args[1] === '1');
        break;
      case 'addtpl': {
        const t = store.addTemplate({
          io: args[0] as Entry['io'] as never,
          cat: args[1],
          amt: Number(args[2]),
          ...(args[3] ? { note: args[3] } : {}),
          name: 'x',
        });
        const n = `t${tplSeq++}`;
        tplName.set(t.id, n);
        tplByName.set(n, t.id);
        break;
      }
      case 'rmtpl':
        store.removeTemplate(tplByName.get(args[0]) ?? args[0]);
        break;
      case 'logtpl': {
        const e = store.logTemplate(tplByName.get(args[0]) ?? args[0]);
        if (e) name(e.id);
        break;
      }
      case 'cat':
        store.addCustomCat('exp', args[0], args[1]);
        break;
      case 'addsc':
        store.addSubcat(args[0], args[1]);
        break;
      case 'rmsc': {
        // Subcat ids are generated, so the corpus addresses them by position.
        // removeSubcat is called even when the position is empty — the real one
        // writes the filtered list back unconditionally, creating the key, and
        // guarding here would have tested the guard rather than the code.
        const list = (store.store$.subcats.peek()[args[0]] ?? []) as { k: string }[];
        const target = list[Number(args[1].replace('sc', ''))];
        store.removeSubcat(args[0], target?.k ?? '__absent__');
        break;
      }

      // --- currency ---
      case 'rate':
        store.setRate(args[0], Number(args[1]));
        break;
      case 'addrate':
        store.addRate(args[0]);
        break;
      case 'rmrate':
        store.removeRate(args[0]);
        break;
      case 'base':
        baseResults.push(store.setBaseCurrency(args[0]));
        break;

      // --- the other denominated collections ---
      case 'asset':
        store.store$.assets.set([
          ...store.store$.assets.peek(),
          { id: `as${store.store$.assets.peek().length}`, name: 'x', type: args[0] as Asset['type'], val: Number(args[1]) },
        ]);
        break;
      case 'loan':
        store.store$.loans.set([
          ...store.store$.loans.peek(),
          {
            id: `l${store.store$.loans.peek().length}`, who: 'x',
            type: args[0] as Loan['type'], amt: Number(args[1]),
            ...(args[2] ? { repaid: Number(args[2]) } : {}), ts: 0,
          },
        ]);
        break;
      case 'sub':
        store.store$.subs.set([
          ...store.store$.subs.peek(),
          {
            id: `s${store.store$.subs.peek().length}`, name: 'x', emoji: 'x',
            amt: Number(args[0]), freq: 'monthly', day: 1, cat: 'misc', created: 0,
          },
        ]);
        break;
      case 'tpl':
        store.store$.templates.set([
          ...store.store$.templates.peek(),
          { id: `t${store.store$.templates.peek().length}`, io: 'exp', cat: 'food', amt: Number(args[0]), name: 'x' },
        ]);
        break;
      case 'budget':
        store.store$.settings.assign({
          budget: Number(args[0]),
          dailyBudget: args[1] ? Number(args[1]) : undefined,
          weeklyBudget: args[2] ? Number(args[2]) : undefined,
          catBudgets: args[3] ? { food: Number(args[3]) } : undefined,
        });
        break;
      case 'upd': {
        const [target, field, value] = args;
        const patch: Record<string, unknown> = {};
        patch[field] = field === 'amt' || field === 'refund' || field === 'ts' ? Number(value) : value;
        store.updateEntry(byName.get(target) ?? target, patch);
        break;
      }
      case 'rm':
        undos.push(store.removeEntry(byName.get(args[0]) ?? args[0]));
        break;
      case 'undo': {
        const u = undos[Number(args[0])];
        if (u) store.unremoveEntry(u);
        break;
      }
      default:
        throw new Error(`unknown verb ${verb}`);
    }
  }

  const out =
    render(store.store$.data.peek(), idOf, acctName) +
    '  ||  ' +
    renderAccounts(store.store$.accounts.peek(), store.store$.curAccount.peek(), acctName) +
    '  ||  ' +
    renderMoney(store) +
    '  ||  ' +
    renderCatalog(store, tplName) +
    '  ||  ' +
    `${baseResults.join(',')}/${refunds.join(',')}`;
  nowSpy.mockRestore();
  return out;
}

it('renders the ledger after each corpus scenario', () => {
  const lines = fs.readFileSync(IN, 'utf8').split('\n').filter(Boolean);
  const out = lines.map((line) => {
    const script = line.replace(/\r$/, '');
    return `${script}\t${runScenario(script)}`;
  });
  fs.writeFileSync(OUT, out.join('\n') + '\n');
});
