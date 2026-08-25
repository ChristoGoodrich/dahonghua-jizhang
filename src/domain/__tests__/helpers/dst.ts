// Finding a daylight-saving transition in whatever timezone the suite happens
// to be running in.
//
// The day-counting tests exist to prove that the domain counts *calendar* days
// rather than 24-hour chunks, and they can only prove it on a day that is not
// 24 hours long. Hard-coding Sydney's transition dates made them pass for the
// wrong reason everywhere else: in a zone with no DST — Asia/Shanghai, UTC, most
// CI runners — every day is 24 hours, so both the old arithmetic and the new one
// agree and the assertions hold without testing anything.
//
// Pinning `TZ` in the Jest config looks like the fix and is not a reliable one:
// this repo's Windows Node resolves no IANA zone name except `UTC` and silently
// falls back to the system zone, so `TZ=Australia/Sydney` would be a guarantee
// on CI and a no-op on the machine the code is written on.
//
// So the tests ask the running zone what it does instead. `describeDst` skips
// with a visible reason where there is no transition to find, which is honest
// about the coverage rather than green about it.

/** The first local day of `year` that is `hours` long, or null if there is none. */
export function findDayOfLength(year: number, hours: 23 | 25): Date | null {
  for (let m = 0; m < 12; m++) {
    for (let d = 1; d <= 31; d++) {
      const a = new Date(year, m, d);
      if (a.getMonth() !== m) break; // rolled into the next month
      const b = new Date(year, m, d + 1);
      if ((b.getTime() - a.getTime()) / 3_600_000 === hours) return a;
    }
  }
  return null;
}

/** The day the clocks go forward (23 hours long), or null. */
export const springForward = (year: number) => findDayOfLength(year, 23);

/** The day the clocks go back (25 hours long), or null. */
export const fallBack = (year: number) => findDayOfLength(year, 25);

/**
 * `describe` a block that needs a DST transition, skipping it where the running
 * timezone has none rather than passing vacuously.
 */
export function describeDst(name: string, year: number, fn: (dst: { forward: Date; back: Date }) => void) {
  const forward = springForward(year);
  const back = fallBack(year);
  if (!forward || !back) {
    describe.skip(`${name} [no DST transition in ${Intl.DateTimeFormat().resolvedOptions().timeZone}]`, () => {
      it('is skipped', () => undefined);
    });
    return;
  }
  describe(name, () => fn({ forward, back }));
}
