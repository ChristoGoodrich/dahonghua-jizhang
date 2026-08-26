// TypeScript half of the sync-engine parity harness.
//
// The engine does not compute an answer; it decides an order of operations
// against a server. So both halves of this comparison are interpreters, and
// what they compare is what the server would have seen: every upload in
// arrival order, every channel opened and closed, every status the UI showed,
// and the ledger and section stamps left behind.
//
// This half drives the shipping engine through a faked Supabase client — the
// same fake shape `src/sync/__tests__/engine.test.ts` uses, because that is the
// boundary the module was written to be testable at. The Rust half
// (`rust/core/examples/dump_engine.rs`) executes its effects against an
// equivalent fake.
//
// Three things pinned so a replay means anything:
//
//   * **The clock.** The section stamps are `Date.now()`. Pinned to a real
//     epoch, not to zero: a stamp of 0 is indistinguishable from a section this
//     device has never edited, which is a different branch of `adoptSections`.
//   * **Timers.** jest's fake timers, advanced explicitly by the `S` command.
//     The Rust side keeps a virtual clock and fires the same deadlines.
//   * **The store.** Runs under jest.parity.config.js, because engine.ts pulls
//     in AsyncStorage and the Legend-State store. It is not part of `npm test`.
//
// It is written as a jest test purely to get those module mocks; it asserts
// nothing itself. `npm run parity` diffs its output against the Rust dump.

import * as fs from 'fs';

const IN = process.env.PARITY_IN as string;
const OUT = process.env.PARITY_OUT as string;

/** 2023-11-14T22:13:20Z. Shared with the Rust half. */
const EPOCH = 1_700_000_000_000;

interface MockChannel {
  name: string;
  handlers: { cfg: Record<string, string>; handler: (payload: unknown) => void }[];
}

interface MockState {
  entries: Record<string, unknown>[];
  profile: Record<string, unknown> | null;
  channels: MockChannel[];
  failPull: boolean;
  failPush: boolean;
  /// Fails only the profile upsert, leaving the entries upsert to succeed.
  /// Without it the "rows landed, config did not" branch is unreachable — and
  /// that branch is where the watermark rule lives.
  failConfigPush: boolean;
  failConfigRead: boolean;
  log: string[];
}

const mockBox: { client: unknown } = { client: null };

jest.mock('../src/sync/supabase', () => ({
  isSyncConfigured: () => mockBox.client !== null,
  get supabase() {
    return mockBox.client;
  },
}));

const num = (v: unknown) => (v === undefined || v === null ? 0 : Number(v));

/** `id@updatedAt`, the same spelling both halves use. */
function showRows(rows: Record<string, unknown>[]): string {
  return rows.map((r) => `${r.id ?? ''}@${num(r.updated_at ?? r.updatedAt)}`).join(',');
}

function showStamps(ts: Record<string, number> | undefined): string {
  if (!ts) return '';
  return Object.keys(ts)
    .map((k) => `${k}=${ts[k] - EPOCH}`)
    .sort()
    .join(',');
}

function makeClient(state: MockState) {
  const query = (result: () => unknown) => {
    const q: any = {
      select: () => q,
      eq: () => q,
      maybeSingle: () => Promise.resolve(result()),
      then: (res: any, rej: any) => Promise.resolve(result()).then(res, rej),
    };
    return q;
  };

  return {
    from(table: string) {
      return {
        select: () =>
          query(() =>
            table === 'entries'
              ? { data: state.entries, error: state.failPull ? new Error('pull failed') : null }
              : {
                  data: state.profile ? { config: state.profile } : null,
                  error: state.failConfigRead ? new Error('config read failed') : null,
                },
          ),
        upsert(payload: any) {
          if (table === 'entries') state.log.push(`E[${showRows(payload)}]`);
          else state.log.push(`C[${showStamps(payload.config?.configTs)}]`);
          const fails = state.failPush || (table === 'profiles' && state.failConfigPush);
          if (fails) return Promise.resolve({ error: new Error('push failed') });
          if (table === 'profiles') state.profile = payload.config;
          else for (const r of payload) {
            const i = state.entries.findIndex((x) => x.id === r.id);
            if (i >= 0) state.entries[i] = r;
            else state.entries.push(r);
          }
          return Promise.resolve({ error: null });
        },
      };
    },
    channel(name: string) {
      const ch: any = { name, handlers: [] };
      ch.on = (_evt: string, cfg: Record<string, string>, handler: (p: unknown) => void) => {
        ch.handlers.push({ cfg, handler });
        return ch;
      };
      ch.subscribe = () => {
        state.log.push(name === 'entries-sync' ? '+e' : '+c');
        return ch;
      };
      state.channels.push(ch as MockChannel);
      return ch;
    },
    removeChannel(ch: MockChannel) {
      state.log.push(ch.name === 'entries-sync' ? '-e' : '-c');
      // Actually remove it. A fake that only logs keeps delivering messages on
      // a closed channel, and the handler still works after sign-out — so a
      // row arriving then landed in the ledger and was pushed with a null user
      // id. Supabase does not do that; the fake was.
      const i = state.channels.indexOf(ch);
      if (i >= 0) state.channels.splice(i, 1);
    },
  };
}

/** A server row, in the snake_case shape the table actually holds. */
const dbRow = (id: string, updated: number, amt: number) => ({
  id, user_id: 'u1', ts: 1000, io: 'exp', cat: 'food', amt,
  subcat: null, cur: null, orig_amt: null, rate: null, note: null, acct: null,
  acct_to: null, fee: null, discount: null, tags: null, ledger: null, rb: null,
  rb_amt: null, refund: null, refund_of: null, from_sub: null, src: null,
  deleted_at: null, updated_at: updated, field_ts: null,
});

/**
 * A row carrying per-field stamps.
 *
 * The field-level merge is the whole reason this port exists — the shipping
 * realtime path compared `updatedAt` and took the whole newer row, discarding
 * concurrent field edits permanently. Without a row that carries `fieldTs` the
 * engine corpus never reaches that path: whole-row resolution only reports a
 * push when the LOCAL row wins, and then its stamp is already the higher one,
 * so the watermark rule has nothing to decide.
 *
 * `ours` stamps the note late and the amount early; `theirs` does the reverse.
 * Merged, each side keeps the field it edited last, and the result is a row the
 * server has never seen — exactly where the watermark must not advance.
 */
const ftRow = (id: string, updated: number, ours: boolean, stamp: number) => ({
  id, ts: 1000, io: 'exp', cat: 'food',
  amt: ours ? 10 : 99,
  note: ours ? 'mine' : 'theirs',
  updatedAt: updated,
  fieldTs: ours ? { note: stamp, amt: 1 } : { amt: stamp, note: 1 },
});

/** The same row as the table holds it. */
const ftDbRow = (id: string, updated: number, ours: boolean, stamp: number) => ({
  ...dbRow(id, updated, ours ? 10 : 99),
  note: ours ? 'mine' : 'theirs',
  field_ts: ours ? { note: stamp, amt: 1 } : { amt: stamp, note: 1 },
});

/** A local row, in the camelCase shape the store holds. */
const localRow = (id: string, updated: number, amt: number) => ({
  id, ts: 1000, io: 'exp', cat: 'food', amt, updatedAt: updated,
});

/** The blob a `P:` or `G:` command describes: sections, optionally stamped. */
function blob(arg: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const ts: Record<string, number> = {};
  for (const part of arg.split(',').filter(Boolean)) {
    const [raw, v] = part.includes('=') ? part.split('=') : [part, undefined];
    // A trailing `!` means present but falsy — an empty string, which is what
    // `curLedger` holds for "no ledger selected". The presence test is nullish
    // precisely so that adopts; a truthy one would refuse it, and nothing else
    // in the corpus can tell the two apart.
    const falsy = raw.endsWith('!');
    const k = falsy ? raw.slice(0, -1) : raw;
    // A zero rather than an empty string: `curLedger`'s own default IS the
    // empty string, so an untouched section would have been indistinguishable
    // from one adopted as empty.
    out[k] = falsy ? 0 : { v: `v-${k}` };
    if (v !== undefined) ts[k] = EPOCH + Number(v);
  }
  if (Object.keys(ts).length) out.configTs = ts;
  return out;
}

/** Every config section, in the sorted order the Rust half uses. */
const SECTIONS = [
  'accounts', 'assets', 'curAccount', 'curLedger', 'currencies', 'customCats',
  'lang', 'loans', 'settings', 'subcats', 'subs', 'tags', 'templates',
];

/**
 * What a section currently holds: `L` for a local edit, the blob's own marker
 * for an adopted one, `E` for one adopted as an empty string, absent when it
 * was never written.
 *
 * Without this, an adoption is only visible through the stamp it sets — so
 * adopting a section whose remote stamp equals the local one was invisible,
 * and so was the difference between a nullish presence test and a truthy one.
 */
function showConfig(store$: any): string {
  const out: string[] = [];
  for (const k of SECTIONS) {
    const v = store$[k].peek();
    // present but falsy: nullish says yes, truthy says no
    if (v === 0) out.push(`${k}=Z`);
    else if (v && typeof v === 'object' && typeof (v as any).v === 'string') {
      const marker = (v as any).v as string;
      out.push(`${k}=${marker.startsWith('local-') ? 'L' : marker}`);
    }
    // anything else is the store's own default, which a device pushes and
    // re-adopts without either side learning anything
  }
  return out.join(',');
}

async function runLine(line: string): Promise<string> {
  jest.resetModules();
  // The whole corpus is ONE jest test, so `afterEach` does not run between
  // lines — and a debounce armed by line N fires inside line N+1's settle,
  // through the previous module instance, into the *new* fake client. That
  // showed up as phantom config uploads on scripts that had never signed in
  // successfully, and looked exactly like an engine divergence.
  jest.clearAllTimers();
  jest.setSystemTime(EPOCH);

  const state: MockState = {
    entries: [], profile: null, channels: [],
    failPull: false, failPush: false, failConfigPush: false,
    failConfigRead: false, log: [],
  };
  mockBox.client = makeClient(state);

  // The official mock exports the store on the module itself under CJS, and
  // `.default` is only present some of the time — take whichever shape it is.
  const mod = require('@react-native-async-storage/async-storage');
  const AsyncStorage = mod.default ?? mod;
  await AsyncStorage.clear();

  const { store$, markDataReady } = require('@/store/ledger');
  markDataReady();
  // stamps only track post-hydration edits, and every edit in a script is one
  store$.hydrated.set(true);

  const { auth$ } = require('../src/sync/auth');
  const engine = require('../src/sync/engine');

  let lastStatus = 'off';
  engine.sync$.status.onChange(() => {
    const s = engine.sync$.status.peek();
    if (s !== lastStatus) {
      lastStatus = s;
      state.log.push(`!${s}`);
    }
  });

  const fire = (name: string, payload: unknown) => {
    for (const ch of state.channels) {
      if (ch.name === name) ch.handlers.forEach((h) => h.handler(payload));
    }
  };
  const settle = (ms: number) => jest.advanceTimersByTimeAsync(ms);

  let signedIn = false;
  for (const cmd of line.split('|')) {
    const i = cmd.indexOf(':');
    const verb = i < 0 ? cmd : cmd.slice(0, i);
    const arg = i < 0 ? '' : cmd.slice(i + 1);
    const p = arg.split(',');
    const at = (k: number, d: number) => (p[k] === undefined || p[k] === '' ? d : Number(p[k]));

    // A seed after sign-in would not be a seed: the store's root subscription
    // is live by then, so writing a row IS a local edit. Both halves refuse it
    // rather than diverging for a reason that has nothing to do with the engine.
    if (['L', 'LF', 'R', 'P', 'FP', 'FC', 'FU', 'FQ'].includes(verb) && signedIn) {
      throw new Error(`${verb} is a seed and must come before the first I`);
    }
    switch (verb) {
      case 'L':
        store$.data.set([...store$.data.peek(), localRow(p[0], at(1, 0), at(2, 1))]);
        break;
      case 'R':
        state.entries.push(dbRow(p[0], at(1, 0), at(2, 1)));
        break;
      case 'LF':
        store$.data.set([...store$.data.peek(), ftRow(p[0], at(1, 0), true, at(2, 1000))]);
        break;
      case 'P':
        state.profile = blob(arg);
        break;
      case 'FP': state.failPull = true; break;
      case 'FU': state.failPush = true; break;
      case 'FQ': state.failConfigPush = true; break;
      case 'FC': state.failConfigRead = true; break;
      case 'OK': state.failPush = false; state.failConfigPush = false; break;
      case 'NG': state.failPush = true; break;
      case 'NQ': state.failConfigPush = true; break;
      case 'I':
        engine.initSync();
        auth$.session.set({ user: { id: 'u1' } });
        signedIn = true;
        await settle(1200);
        break;
      case 'O':
        auth$.session.set(null);
        await settle(1200);
        break;
      case 'E':
        // a fresh object every time, so Legend-State sees a change
        store$[p[0]].set({ v: `local-${Date.now()}-${Math.random()}` });
        break;
      case 'N': {
        // In place when the id is already there, appended when it is not —
        // which is what the ledger's own update does. Filtering and appending
        // instead would move the row to the end and diverge on order alone.
        const rows = [...store$.data.peek()];
        const row = localRow(p[0], at(1, 0), at(2, 1));
        const k = rows.findIndex((e: any) => e.id === p[0]);
        if (k >= 0) rows[k] = row;
        else rows.push(row);
        store$.data.set(rows);
        break;
      }
      case 'T': fire('entries-sync', { new: dbRow(p[0], at(1, 0), at(2, 1)) }); break;
      case 'TF':
        fire('entries-sync', { new: ftDbRow(p[0], at(1, 0), false, at(2, 2000)) });
        break;
      case 'TX': fire('entries-sync', { new: undefined }); break;
      // A payload that IS a row but carries no id. `!row.id` is truthy, not a
      // null check, so an empty string is as unusable as a missing key — and
      // `TX` alone never reaches that test, because an absent payload is
      // refused one clause earlier.
      case 'TZ': fire('entries-sync', { new: { ...dbRow('', 1, 1) } }); break;
      case 'G': fire('config-sync', { new: { config: blob(arg) } }); break;
      case 'GX': fire('config-sync', { new: { config: {} } }); break;
      case 'Y':
        engine.retrySync();
        // Let the flush finish before the next command. Otherwise `Y|O` is a
        // race rather than a decision, and a corpus that compares races
        // compares promise scheduling — which is not what was ported.
        await settle(0);
        break;
      case 'S': await settle(1200); break;
      // Three seconds: long enough for a 2s retry, short enough that a 4s one
      // is still pending. Without a window between them the backoff's doubling
      // is invisible — every delay looks the same to a 70-second settle.
      case 'S3': await settle(3000); break;
      // Sixty-two seconds: past the 60s ceiling, short of the 64s an uncapped
      // backoff would have reached. The only window in which the cap shows.
      case 'S6': await settle(62_000); break;
      case 'S9': await settle(70_000); break;
      case '': break;
      default: throw new Error(`unknown command ${verb}`);
    }
  }

  const ledger = store$.data
    .peek()
    .map((e: any) => `${e.id}@${num(e.updatedAt)}`)
    .join(',');
  const server = state.entries
    .map((r: any) => `${r.id}@${num(r.updated_at)}`)
    .sort()
    .join(',');
  // The stamps as the engine persisted them — observable without forcing a
  // push, which would change the very log being compared.
  const rawTs = await AsyncStorage.getItem('dhh_config_ts_v1');
  const stamps = showStamps(rawTs ? JSON.parse(rawTs) : undefined);

  return `${state.log.join(' ')} :: local=${ledger} server=${server} stamps=${stamps} config=${showConfig(store$)} status=${lastStatus}`;
}

describe('engine parity dump', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('replays the corpus', async () => {
    const raw = fs.readFileSync(IN, 'utf8');
    const out: string[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.replace(/\r$/, '');
      if (!trimmed) continue;
      out.push(await runLine(trimmed));
    }
    fs.writeFileSync(OUT, out.join('\n') + '\n');
  }, 600_000);
});
