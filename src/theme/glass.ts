// 柔光玻璃 — the soft-light glass material, as this app implements it.
//
// HyperOS 4 (announced 2026-08-13) describes the material by three behaviours
// rather than by numbers; Xiaomi has published no developer spec with concrete
// blur radii or alpha curves. What is stated publicly is:
//
//   1. 感知环境颜色 — it samples the colours behind it and blends with them
//      instead of sitting on top as a neutral frost.
//   2. 根据内容属性自动调整通透度 — translucency is not fixed; it moves so that
//      whatever is underneath stays readable.
//   3. 感知交互行为 — a light response that follows the user's touch.
//
// …and that the material is gated to flagship silicon, which is a design fact
// as much as a hardware one: the look must degrade without falling apart.
//
// Everything below is our reading of those three behaviours, not a quotation of
// a Xiaomi spec. Two honest departures from what an OS can do:
//
//   * True ambient sampling composites what is *behind the app window*. React
//     Native cannot read those pixels. We do the tractable half: a surface is
//     told which of our own colours it sits over, and blends its wash toward
//     that. Within the app — which is all a ledger ever draws over — the effect
//     is the intended one.
//   * `expo-blur` gives one intensity, not a refraction model. Depth here comes
//     from the wash, the specular top edge, and the hairline — not from a
//     simulated lens.
//
// The flower palette stays in charge. Glass is a material the existing theme is
// rendered *in*; it never repaints the room.

import { Platform, StyleSheet } from 'react-native';
import type { Theme } from './tokens';

/** How much of the material a device can actually render.
 *
 *  Mirrors the way HyperOS 4 itself gates the effect on the SoC: every tier
 *  below `full` is a complete design, not a broken one. */
export type GlassTier = 'full' | 'wash' | 'solid';

/**
 * `full`  — real backdrop blur behind a translucent wash.
 * `wash`  — no blur, but still translucent: content shows through as colour.
 * `solid` — opaque surface, for when the user has asked for less transparency.
 *
 * Nothing in the app drives `solid` yet: it is reachable by passing the tier
 * explicitly, and is waiting on a "减少透明度 / Reduce transparency" setting.
 * Android exposes no OS-level equivalent to hang it off, so it has to be ours.
 */
export function resolveTier(opts: { reduceTransparency?: boolean } = {}): GlassTier {
  if (opts.reduceTransparency) return 'solid';
  // react-native-web maps BlurView onto backdrop-filter, which Safari and
  // Chrome both support but which costs a compositing layer per surface; the
  // wash tier looks nearly identical over our own flat backgrounds.
  if (Platform.OS === 'web') return 'wash';
  return 'full';
}

/** Where a glass surface sits in the stack. Depth, not decoration:
 *  `chrome` floats over scrolling content, `sheet` covers it, `card` rests in
 *  it. Each gets progressively less blur and more body. */
export type GlassLevel = 'chrome' | 'sheet' | 'card';

export interface GlassSpec {
  /** expo-blur intensity, 0–100. Ignored below the `full` tier. */
  intensity: number;
  /** Alpha applied to the wash colour, as a 0–1 fraction. */
  washAlpha: number;
  /** Wash alpha when the tier cannot blur — more body is needed to hold
   *  contrast without the blur flattening what is underneath. */
  washAlphaFlat: number;
  /** Specular highlight strength along the top edge. */
  sheen: number;
  /** How far that highlight falls before it fades out. A soft band, not a
   *  hairline — a 1px line reads as a stroke, a band reads as light catching
   *  the curve of the surface. */
  sheenHeight: number;
  /** Colour of the lit edge. */
  edge: string;
  /** Width of that edge. Chrome carries a full point so the bar keeps its own
   *  outline against a busy list; a card only needs a hairline. */
  edgeWidth: number;
}

const HAIRLINE = StyleSheet.hairlineWidth;

const LIGHT: Record<GlassLevel, GlassSpec> = {
  chrome: { sheenHeight: 26, intensity: 62, washAlpha: 0.54, washAlphaFlat: 0.86, sheen: 0.5, edge: 'rgba(255,255,255,0.65)', edgeWidth: 1 },
  sheet: { sheenHeight: 22, intensity: 48, washAlpha: 0.82, washAlphaFlat: 0.95, sheen: 0.38, edge: 'rgba(255,255,255,0.55)', edgeWidth: 1 },
  card: { sheenHeight: 14, intensity: 30, washAlpha: 0.9, washAlphaFlat: 1, sheen: 0.22, edge: 'rgba(255,255,255,0.42)', edgeWidth: HAIRLINE },
};

const DARK: Record<GlassLevel, GlassSpec> = {
  chrome: { sheenHeight: 26, intensity: 70, washAlpha: 0.62, washAlphaFlat: 0.9, sheen: 0.14, edge: 'rgba(255,255,255,0.14)', edgeWidth: 1 },
  sheet: { sheenHeight: 22, intensity: 54, washAlpha: 0.85, washAlphaFlat: 0.96, sheen: 0.1, edge: 'rgba(255,255,255,0.12)', edgeWidth: 1 },
  card: { sheenHeight: 14, intensity: 34, washAlpha: 0.92, washAlphaFlat: 1, sheen: 0.07, edge: 'rgba(255,255,255,0.09)', edgeWidth: HAIRLINE },
};

export function glassSpec(t: Theme, level: GlassLevel): GlassSpec {
  return (t.isDark ? DARK : LIGHT)[level];
}

/* -------------------------------------------------------------------------- */

/** `#RGB` / `#RRGGBB` / `#RRGGBBAA` → `[r, g, b]`. */
function parseHex(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mix two colours in sRGB. `amount` is how much of `b` ends up in the result. */
export function mix(a: string, b: string, amount: number): [number, number, number] {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const k = Math.min(1, Math.max(0, amount));
  return [
    Math.round(ar + (br - ar) * k),
    Math.round(ag + (bg - ag) * k),
    Math.round(ab + (bb - ab) * k),
  ];
}

/** 感知环境颜色 — the wash a glass surface should paint, given the colour it
 *  sits over.
 *
 *  The surface never renders as neutral frost: it carries `t.card` pulled a
 *  little toward whatever is beneath, so a bar over the warm paper reads warm
 *  and the same bar over an accent header picks the accent up. `AMBIENT_PULL`
 *  is deliberately gentle — past roughly a third the surface stops reading as
 *  its own object and starts looking like a stain on the background.
 *
 *  @param under  the colour behind this surface; defaults to the page paper
 *  @param alpha  overrides the level's wash alpha (see `readabilityAlpha`) */
const AMBIENT_PULL = 0.28;

export function washColor(t: Theme, level: GlassLevel, under?: string, alpha?: number): string {
  const spec = glassSpec(t, level);
  const [r, g, b] = mix(t.card, under ?? t.paper, AMBIENT_PULL);
  return `rgba(${r}, ${g}, ${b}, ${alpha ?? spec.washAlpha})`;
}

/** 根据内容属性自动调整通透度 — how opaque the wash has to be for what is
 *  underneath.
 *
 *  `density` is the caller's read of the content behind the surface, 0 (empty
 *  paper) to 1 (dense text or imagery). Glass over an empty ledger can be
 *  nearly clear; the same glass over a full month of entries has to carry more
 *  body or the labels on top stop resolving. Readability wins — the ceiling
 *  rises with density and never falls below the level's resting value. */
export function readabilityAlpha(t: Theme, level: GlassLevel, density: number, tier: GlassTier): number {
  // `solid` is not "a bit less transparent" — it is the tier a user lands on by
  // asking for less transparency, so it has to actually be opaque.
  if (tier === 'solid') return 1;
  const spec = glassSpec(t, level);
  const base = tier === 'full' ? spec.washAlpha : spec.washAlphaFlat;
  const d = Math.min(1, Math.max(0, density));
  return Math.min(1, base + (1 - base) * d * 0.75);
}

/** 感知交互行为 — the specular bloom that answers a touch.
 *
 *  Returned as a plain alpha the caller animates; the highlight itself is a
 *  radial wash the pressed surface paints over its own wash. Warm white in
 *  light mode, plain white in dark, so the bloom belongs to the palette rather
 *  than punching a hole in it. */
export function touchLightColor(t: Theme): string {
  return t.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,252,247,0.72)';
}
