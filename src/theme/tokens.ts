// Design tokens — the app's full design system.
// Colors ported from the v7 prototype's CSS custom properties (four flower
// themes + dark-mode surface overrides), extended with a systematic scale for
// spacing, radii, typography, elevation and motion so every screen shares the
// same rhythm.
import type { TextStyle, ViewStyle } from 'react-native';
import type { ThemeKey } from '@/domain/types';

export interface Theme {
  // brand accents
  hibiscus: string;
  hibiscusDeep: string;
  hibiscusSoft: string;
  stamen: string;
  leaf: string;
  leafDeep: string;
  // surfaces & text
  paper: string;
  paperWarm: string;
  ink: string;
  inkSoft: string;
  line: string;
  card: string;
  // derived — selected-state tints and gradient stops (follow the accent)
  tint: string; // accent fill for selected chips / pills (≈8% alpha)
  tintStrong: string; // stronger accent wash (≈15% alpha)
  gradFrom: string; // accent gradient start (buttons, FAB, summary wash)
  gradTo: string; // accent gradient end
  // elevation colors
  shadow: string; // neutral shadow (warm brown on paper, black in dark)
  glow: string; // accent-colored glow behind primary actions
  overlay: string; // modal scrim
  isDark: boolean;
}

const BASE = {
  hibiscus: '#D94E5C', hibiscusDeep: '#B83A48', hibiscusSoft: '#EC9AA2',
  stamen: '#E8A838', leaf: '#6FA88F', leafDeep: '#4E7A68',
  paper: '#FBF7F0', paperWarm: '#F6EEE2', ink: '#2B2622', inkSoft: '#8A8178',
  line: '#EADFCF', card: '#FFFFFF',
};

// per-theme overrides: accents (from body[data-theme=...]) plus a faint
// light-mode surface tint so each flower sets the whole room's atmosphere,
// not just the buttons. Dark mode keeps the shared neutral surfaces below.
const THEME_ACCENTS: Record<ThemeKey, Partial<typeof BASE>> = {
  default: {},
  sakura: {
    hibiscus: '#E8869B', hibiscusDeep: '#C76482', hibiscusSoft: '#F2B3C4', stamen: '#E8A838',
    paper: '#FCF5F3', paperWarm: '#F8EBE8', line: '#F0DCDA',
  },
  daisy: {
    hibiscus: '#E0A93C', hibiscusDeep: '#BC8A26', hibiscusSoft: '#F0CE84', stamen: '#D94E5C',
    paper: '#FCF8ED', paperWarm: '#F7EFDA', line: '#EDE2C6',
  },
  jasmine: {
    hibiscus: '#7C9C8F', hibiscusDeep: '#5C7C6F', hibiscusSoft: '#A8C2B8', stamen: '#E8A838',
    paper: '#F6F9F5', paperWarm: '#ECF1EA', line: '#DCE6DA',
  },
  ocean: {
    hibiscus: '#4A90B8', hibiscusDeep: '#3670A0', hibiscusSoft: '#8DC0E0', stamen: '#E8A838',
    paper: '#F2F7FB', paperWarm: '#E4EEF6', line: '#D0DEE8',
  },
  forest: {
    hibiscus: '#5C8A5C', hibiscusDeep: '#3E6B3E', hibiscusSoft: '#94C494', stamen: '#E8A838',
    paper: '#F3F7F2', paperWarm: '#E6EDE5', line: '#D5DFD4',
  },
  sunset: {
    hibiscus: '#D97840', hibiscusDeep: '#B85E2A', hibiscusSoft: '#E8AB80', stamen: '#E8A838',
    paper: '#FBF5EF', paperWarm: '#F6EBE0', line: '#EEDDD0',
  },
};

// surface overrides for dark mode (accent is kept)
const DARK_SURFACES = {
  paper: '#1C1A18', paperWarm: '#262320', ink: '#F0EAE2', inkSoft: '#9A9186',
  line: '#3A3531', card: '#262320',
};

export function makeTheme(themeKey: ThemeKey = 'default', dark = false): Theme {
  const base = { ...BASE, ...THEME_ACCENTS[themeKey], ...(dark ? DARK_SURFACES : {}) };
  return {
    ...base,
    tint: base.hibiscus + (dark ? '26' : '14'),
    tintStrong: base.hibiscus + (dark ? '3D' : '26'),
    gradFrom: base.hibiscus,
    gradTo: base.hibiscusDeep,
    shadow: dark ? '#000000' : '#6B4632',
    glow: base.hibiscusDeep,
    // warm ink rather than black — a neutral-black scrim reads as a cheap
    // dimmer over the paper palette; this keeps the room lit while the sheet
    // still separates cleanly
    overlay: dark ? 'rgba(10,8,7,0.58)' : 'rgba(58,44,36,0.32)',
    isDark: dark,
  };
}

export const THEME_KEYS: ThemeKey[] = ['default', 'sakura', 'daisy', 'jasmine', 'ocean', 'forest', 'sunset'];

// representative accent swatch for the theme picker
export const THEME_SWATCH: Record<ThemeKey, string> = {
  default: '#D94E5C', sakura: '#E8869B', daisy: '#E0A93C', jasmine: '#7C9C8F',
  ocean: '#4A90B8', forest: '#5C8A5C', sunset: '#D97840',
};

// ---------------------------------------------------------------------------
// Scales — one shared rhythm for the whole app.

/** Spacing scale. `page` is the screen gutter. */
export const SP = { xxs: 4, xs: 6, sm: 8, md: 12, lg: 16, xl: 20, page: 22 } as const;

/** Radius scale: xs inputs · sm rows/keys · md cards · lg feature cards · xl sheets. */
export const RAD = { xs: 10, sm: 14, md: 16, lg: 22, xl: 28, pill: 999 } as const;

/** Monospaced digits — every money amount and counter should carry this. */
export const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

/** Small tracked section label (Chinese has no caps, so tracking does the work). */
export const LABEL_TRACKED: TextStyle = { fontSize: 12, fontWeight: '700', letterSpacing: 1 };

/** `#RRGGBB` → `rgba(r,g,b,a)` — box-shadow needs the alpha inside the color.
 *  Defaults to black so a partial theme (test mocks) still yields a valid CSS
 *  color instead of throwing mid-render. */
function rgba(hex: string | undefined, a: number): string {
  const h = (hex ?? '#000000').replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Theme-aware soft shadows. Border hairlines still come from `t.line`.
 *
 *  Emitted as `boxShadow`, never `elevation`: Android's elevation shadow is a
 *  hard grey drop that ignores shadowColor/blur, so the warm, wide, barely-there
 *  shadow this palette is built on only survives as a real box-shadow (RN 0.85 +
 *  react-native-web 0.21 both take the CSS string on every platform). Keep the
 *  levels *quiet* — depth here comes from the paper/card contrast and the
 *  hairline border; the shadow is only there to lift a surface off the page. */
export function shadow(t: Theme, level: 'xs' | 'sm' | 'md' | 'lg' | 'glow', glowColor?: string): ViewStyle {
  if (level === 'glow') {
    // accent-tinted, not a dark drop — a primary button should feel warm, not heavy
    return { boxShadow: `0px 5px 16px ${rgba(glowColor ?? t.glow, t.isDark ? 0.34 : 0.2)}` };
  }
  const table = {
    xs: { a: t.isDark ? 0.28 : 0.045, blur: 4, y: 1 },
    sm: { a: t.isDark ? 0.32 : 0.06, blur: 10, y: 3 },
    md: { a: t.isDark ? 0.38 : 0.08, blur: 20, y: 7 },
    // floating layers (nav bar, sheets, toast): wide blur reads as ambient depth
    // instead of a hard drop that the viewport edge clips off
    lg: { a: t.isDark ? 0.5 : 0.12, blur: 30, y: 12 },
  }[level];
  return { boxShadow: `0px ${table.y}px ${table.blur}px ${rgba(t.shadow, table.a)}` };
}

/** Shared spring characters — snappy for touch feedback, soft for layout moves. */
export const SPRING = {
  snappy: { friction: 6, tension: 300 },
  soft: { friction: 7, tension: 170 },
} as const;
