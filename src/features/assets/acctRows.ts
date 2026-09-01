// Which entries touched one account, and by how much.
//
// Extracted from `app/account-detail.tsx`, where it was a `useMemo` inside the
// component. It is moved rather than copied: a component is not a place a
// second implementation can be compared against, and this is the shape the
// Rust port is checked against by `npm run parity`.
//
// The rules are not symmetric and each one is a decision:
//
//   - A transfer appears TWICE, once per side, with a different delta each
//     time. Leaving an account costs the amount plus the fee; arriving credits
//     the amount plus any discount. The fee is paid by the sender and the
//     discount is received by the recipient, which is why they attach to
//     different sides.
//   - An entry with no account at all belongs to `default`. The app has always
//     written entries without an `acct` — that is what the ledger looked like
//     before accounts existed — and they have to show up somewhere.
//   - Tombstones are skipped. This is a display list.

import type { Entry } from '@/domain/types';

export type AcctRow = { d: Entry; delta: number };

export function acctRows(id: string, data: Entry[]): AcctRow[] {
  if (!id) return [];
  const out: AcctRow[] = [];
  for (const d of data) {
    if (d.deletedAt) continue;
    if (d.io === 'xfer') {
      if (d.acct === id) out.push({ d, delta: -(d.amt + (d.fee ?? 0)) });
      else if (d.acctTo === id) out.push({ d, delta: d.amt + (d.discount ?? 0) });
    } else if (d.acct === id || (!d.acct && id === 'default')) {
      out.push({ d, delta: d.io === 'inc' ? d.amt : -d.amt });
    }
  }
  return out.sort((a, b) => b.d.ts - a.d.ts);
}
