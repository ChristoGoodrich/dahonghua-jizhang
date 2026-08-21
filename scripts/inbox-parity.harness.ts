// TypeScript half of the capture-inbox parity harness.
//
// Runs under jest.parity.config.js because inbox.ts reaches for AsyncStorage,
// the native capture module and AppState. None of those are part of what is
// being compared — the deciding half is `alreadySeen` plus the classification
// loop inside `drainInbox` — so the loop is reproduced here against the same
// exported helpers the real function calls, and the I/O is left out.
//
// Reproducing it is a real cost: this file can drift from the function it
// mirrors. It is accepted because the alternative is mocking a native module,
// AsyncStorage and an AppState subscription in order to observe six lines of
// branching, and a mock that elaborate is its own kind of drift.

import * as fs from 'fs';
import {
  DUP_WINDOW_MS,
  fullText,
  isDuplicate,
  parseNotification,
  toEntryDraft,
  type NotifEntryDraft,
  type PaymentKey,
} from '@/domain/notifParse';
import type { Category, Entry, IO } from '@/domain/types';

const IN = process.env.PARITY_IN!;
const OUT = process.env.PARITY_OUT!;

const MAX_UNPARSED = 30;

interface PendingItem {
  id: string;
  draft: NotifEntryDraft;
  source: string;
  raw: string;
}
interface UnparsedItem {
  id: string;
  pkg: string;
  raw: string;
  postedAt: number;
}

const PKG = {
  ali: 'com.eg.android.AlipayGphone',
  wx: 'com.tencent.mm',
  other: 'com.example.other',
} as const;

/** An empty field is the empty string; `_` is an absent field. `~` cannot be
 *  the sentinel for "empty" because it is already the record separator. */
const cell = (s: string | undefined) => (s === undefined || s === '_' ? undefined : s);

/** id^pkg^title^text^bigText^postedAt */
function parseRaw(rec: string) {
  const f = rec.split('^');
  return {
    id: f[0],
    pkg: PKG[f[1] as keyof typeof PKG] ?? f[1],
    title: cell(f[2]),
    text: cell(f[3]),
    bigText: cell(f[4]),
    postedAt: Number(f[5]),
  };
}

/** io^amt^ts^src^deleted */
function parseEntry(rec: string, i: number): Entry {
  const f = rec.split('^');
  return {
    id: `e${i}`,
    ts: Number(f[2]),
    io: f[0] as IO,
    cat: 'food',
    amt: Number(f[1]),
    ...(f[3] && f[3] !== '_' ? { src: f[3] as 'notif' | 'bill' } : {}),
    ...(f[4] === '1' ? { deletedAt: 1 } : {}),
  } as Entry;
}

/** io^amt^ts — a row already waiting in the confirm queue */
function parsePending(rec: string, i: number): PendingItem {
  const f = rec.split('^');
  return {
    id: `p${i}`,
    draft: {
      io: f[0] as 'exp' | 'inc',
      amt: Number(f[1]),
      cat: 'other',
      note: '',
      ts: Number(f[2]),
      confident: false,
    },
    source: 'alipay',
    raw: '',
  };
}

/** The deciding half of drainInbox, with the native queue and the store left out. */
function drain(
  raws: ReturnType<typeof parseRaw>[],
  pending0: PendingItem[],
  entries: Entry[],
  custom: Category[],
) {
  if (!raws.length) return { post: [], queue: [], unparsed: [] as UnparsedItem[] };

  const times = raws.map((r) => r.postedAt);
  const from = Math.min(...times) - DUP_WINDOW_MS;
  const to = Math.max(...times) + DUP_WINDOW_MS;

  const seen: PaymentKey[] = pending0.map((p) => ({
    io: p.draft.io,
    amt: p.draft.amt,
    postedAt: p.draft.ts,
  }));
  for (const e of entries) {
    if (e.src !== 'notif' || e.deletedAt || e.io === 'xfer') continue;
    if (e.ts < from || e.ts > to) continue;
    seen.push({ io: e.io as 'exp' | 'inc', amt: e.amt, postedAt: e.ts });
  }

  const post: NotifEntryDraft[] = [];
  const queue: PendingItem[] = [];
  const unparsed: UnparsedItem[] = [];

  for (const r of raws) {
    const candidate = parseNotification(r as Parameters<typeof parseNotification>[0]);
    if (!candidate) {
      unparsed.push({ id: r.id, pkg: r.pkg, raw: fullText(r as never), postedAt: r.postedAt });
      continue;
    }
    if (isDuplicate(candidate, seen)) continue;
    seen.push(candidate);
    const draft = toEntryDraft(candidate, custom);
    if (draft.confident) post.push(draft);
    else queue.push({ id: r.id, draft, source: candidate.source, raw: fullText(r as never) });
  }
  return { post, queue, unparsed };
}

const d = (x: NotifEntryDraft) => `${x.io}/${x.amt}/${x.cat}/${x.note}/${x.ts}/${x.confident}`;

function answer(arg: string): string {
  // raws | pending | entries        (sections may be empty)
  const [rawSec, pendSec, entSec] = arg.split('|');
  const raws = rawSec ? rawSec.split('~').map(parseRaw) : [];
  const pending = pendSec ? pendSec.split('~').map(parsePending) : [];
  const entries = entSec ? entSec.split('~').map(parseEntry) : [];

  const out = drain(raws, pending, entries, []);

  // fold into the inbox the way the store does, so the MAX_UNPARSED trim shows
  const unparsed = [...out.unparsed].slice(-MAX_UNPARSED);
  return [
    `post[${out.post.map(d).join(',')}]`,
    `queue[${out.queue.map((q) => `${q.id}/${q.source}/${d(q.draft)}/${q.raw}`).join(',')}]`,
    `unparsed[${unparsed.map((u) => `${u.id}/${u.pkg}/${u.raw}/${u.postedAt}`).join(',')}]`,
    `counts=${out.post.length}/${out.queue.length}/${out.unparsed.length}`,
  ].join('  ||  ');
}

it('classifies each corpus batch', () => {
  const lines = fs.readFileSync(IN, 'utf8').split('\n').filter(Boolean);
  const out = lines.map((line) => {
    const arg = line.replace(/\r$/, '');
    return `${arg}\t${answer(arg)}`;
  });
  fs.writeFileSync(OUT, out.join('\n') + '\n');
});
