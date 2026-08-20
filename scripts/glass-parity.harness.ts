// TypeScript half of the 柔光玻璃 parity harness.
//
// This runs under jest.parity.config.js rather than plain tsx for one reason:
// `src/theme/glass.ts` imports `Platform` and `StyleSheet` from react-native,
// which esbuild will not transform. Only two values need them — the hairline
// edge width and `resolveTier`'s web check — but they are enough to keep the
// module out of tsx, and jest already has the mocks.
//
// It asserts nothing itself. `npm run parity` diffs its output against the
// Rust dump.

import * as fs from 'fs';
import { Platform } from 'react-native';
import {
  ambientPull,
  glassSpec,
  luminance,
  mix,
  readabilityAlpha,
  resolveTier,
  touchLightColor,
  washColor,
} from '../src/theme/glass';
import type { GlassLevel, GlassTier } from '../src/theme/glass';
import type { Theme } from '../src/theme/tokens';

const IN = process.env.PARITY_IN!;
const OUT = process.env.PARITY_OUT!;

/** The three fields glass.ts actually reads off a Theme. The Rust port takes
 *  exactly these, so the rest of the palette never crosses the boundary. */
const theme = (isDark: boolean, card: string, paper: string) =>
  ({ isDark, card, paper }) as unknown as Theme;

const LEVELS: Record<string, GlassLevel> = { chrome: 'chrome', sheet: 'sheet', card: 'card' };
const TIERS: Record<string, GlassTier> = { full: 'full', wash: 'wash', solid: 'solid' };

const opt = (s: string) => (s === '' ? undefined : s);
const optNum = (s: string) => (s === '' ? undefined : Number(s));

function answer(kind: string, f: string[]): string {
  switch (kind) {
    case 'lum':
      // hex
      return String(luminance(f[0]));
    case 'mix': {
      // a^b^amount
      return mix(f[0], f[1], Number(f[2])).join(',');
    }
    case 'pull':
      // surface^under
      return String(ambientPull(f[0], f[1]));
    case 'wash': {
      // isDark^card^paper^level^under^alpha^surface
      const t = theme(f[0] === '1', f[1], f[2]);
      return washColor(t, LEVELS[f[3]], opt(f[4]), optNum(f[5]), opt(f[6]));
    }
    case 'alpha': {
      // isDark^level^density^tier
      const t = theme(f[0] === '1', '#FFFFFF', '#FBF7F0');
      return String(readabilityAlpha(t, LEVELS[f[1]], Number(f[2]), TIERS[f[3]]));
    }
    case 'spec': {
      // isDark^level  — the whole table row, so a mistyped constant shows
      const s = glassSpec(theme(f[0] === '1', '#FFFFFF', '#FBF7F0'), LEVELS[f[1]]);
      return [s.intensity, s.washAlpha, s.washAlphaFlat, s.sheen, s.sheenHeight, s.edge].join('|');
    }
    case 'tier':
      // reduceTransparency, on whatever platform jest reports
      return resolveTier({ reduceTransparency: f[0] === '1' });
    case 'tierweb': {
      // reduceTransparency^isWeb. The Rust port takes `is_web` as an argument
      // because a crate cannot ask what platform it is on; the TypeScript
      // reads Platform.OS, so the harness has to steer it to compare the two.
      const prev = Platform.OS;
      (Platform as { OS: string }).OS = f[1] === '1' ? 'web' : 'android';
      try {
        return resolveTier({ reduceTransparency: f[0] === '1' });
      } finally {
        (Platform as { OS: string }).OS = prev;
      }
    }
    case 'touch':
      return touchLightColor(theme(f[0] === '1', '#FFFFFF', '#FBF7F0'));
    default:
      throw new Error(`unknown corpus kind ${kind}`);
  }
}

it('renders the glass material for each corpus case', () => {
  const lines = fs.readFileSync(IN, 'utf8').split('\n').filter(Boolean);
  const out = lines.map((line) => {
    const trimmed = line.replace(/\r$/, '');
    const tab = trimmed.indexOf('\t');
    const kind = trimmed.slice(0, tab);
    const arg = trimmed.slice(tab + 1);
    return `${kind}\t${arg}\t${answer(kind, arg.split('^'))}`;
  });
  fs.writeFileSync(OUT, out.join('\n') + '\n');
});
