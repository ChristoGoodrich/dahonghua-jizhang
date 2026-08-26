// Per-section merge for the config blob — the decision half of engine.ts's
// `applyConfig`, with the store and the network left behind.
//
// The config is one row, but it carries independent domains (accounts, tags,
// subs…). Whole-blob last-write-wins meant two devices editing DIFFERENT
// sections clobbered each other: A adds an account, B renames a tag, and
// whichever pushed last erased the other's change — including money-adjacent
// state like account balances and subscription cursors. Each section carries
// its own last-edit timestamp; a remote section is adopted only when its stamp
// is newer than the local one. Edits within one section still LWW as a unit,
// which matches how the UI edits them.
//
// Extracted so the rule can be read and tested on its own. It was previously
// reachable only through a faked Supabase client, which is a lot of machinery
// standing between a reader and four lines of comparison.

export const CONFIG_SECTIONS = [
  'lang', 'settings', 'customCats', 'accounts', 'assets', 'loans', 'subs',
  'templates', 'tags', 'curLedger', 'currencies', 'subcats', 'curAccount',
] as const;

export type SectionKey = (typeof CONFIG_SECTIONS)[number];
export type Stamps = Record<string, number>;

/** Does the blob actually carry this section?
 *
 *  Nullish, not truthy. `curLedger` is `''` when no ledger filter is active,
 *  and a truthiness test would have made that value unadoptable — it was
 *  special-cased for exactly that reason while `lang` and `curAccount`, both
 *  also strings, were left on the truthy test. Making the rule uniform removes
 *  the class rather than the instance, and still refuses a `null` section from
 *  a legacy blob, which would otherwise be written into the store as-is. */
export function sectionPresent(blob: Record<string, unknown>, k: SectionKey): boolean {
  return blob[k] != null;
}

export interface Adoption {
  /** Sections whose remote copy wins and should be written to the store. */
  take: SectionKey[];
  /** The local stamps after adopting — adopting takes the remote stamp too,
   *  so later comparisons stay stable across devices. */
  stamps: Stamps;
}

/**
 * Which sections of a remote blob to adopt, given what this device last edited.
 *
 * Legacy blobs carry no stamps at all. Their sections are treated as barely
 * newer than "never edited" (1 > 0) so a fresh device still adopts them, while
 * any real local edit — a `Date.now()`, therefore enormous — wins.
 */
export function adoptSections(
  local: Stamps,
  remoteTs: Stamps | undefined,
  present: (k: SectionKey) => boolean,
): Adoption {
  const rts = remoteTs ?? {};
  const stamps: Stamps = { ...local };
  const take: SectionKey[] = [];
  for (const k of CONFIG_SECTIONS) {
    if (!present(k)) continue;
    const r = rts[k] ?? 1;
    if (r <= (stamps[k] ?? 0)) continue;
    stamps[k] = r;
    take.push(k);
  }
  return { take, stamps };
}

/** True when any locally-stamped section is newer than the remote blob's stamp
 *  — i.e. the server copy is missing local edits and needs a push. */
export function localNewerThan(local: Stamps, remoteTs: Stamps | undefined): boolean {
  const rts = remoteTs ?? {};
  return CONFIG_SECTIONS.some((k) => (local[k] ?? 0) > (rts[k] ?? 1));
}
