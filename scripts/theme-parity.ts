// TypeScript half of the theme parity harness.
//
// `makeTheme` is colour arithmetic over a table of constants, which sounds
// like the least likely thing in the app to diverge — and is exactly why it is
// worth pinning. Two of its rules are easy to "tidy" into something different:
// the alpha is string CONCATENATION rather than an opacity, and dark mode
// replaces surfaces AFTER the per-theme overrides rather than before.
//
// The corpus is exhaustive: seven themes times two modes times every field. A
// table of constants sampled at random only tests the sampler.

import { makeTheme, THEME_SWATCH } from '../src/theme/tokens';
import type { ThemeKey } from '../src/domain/types';

const raw = require('fs').readFileSync(0, 'utf8') as string;

/** The Rust side takes an unknown key as `default`; so does this, explicitly,
 *  rather than relying on a lookup happening to yield undefined. */
const KEYS = ['default', 'sakura', 'daisy', 'jasmine', 'ocean', 'forest', 'sunset'];
const keyOf = (s: string): ThemeKey =>
  (KEYS.includes(s) ? s : 'default') as ThemeKey;

const out: string[] = [];
for (const line of raw.split('\n')) {
  const l = line.replace(/\r$/, '');
  if (!l) continue;
  const [rawKey, darkFlag, field] = l.split('\t');
  const key = keyOf(rawKey);
  const dark = darkFlag === '1';
  // Through `unknown`: `Theme` has named fields and no index signature, so
  // TypeScript refuses the direct cast — correctly, since the whole point here
  // is to look a field up by a name that comes from the corpus rather than
  // from the type. This is the harness reaching past the type on purpose.
  const t = makeTheme(key, dark) as unknown as Record<string, unknown>;

  let value: string;
  if (field === 'swatch') {
    value = THEME_SWATCH[key];
  } else if (field === 'isDark') {
    value = t.isDark ? '1' : '0';
  } else {
    value = String(t[field]);
  }
  out.push(value);
}
process.stdout.write(out.join('\n') + '\n');
