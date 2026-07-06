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
    overlay: dark ? 'rgba(0,0,0,0.55)' : 'rgba(43,38,34,0.42)',
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

/** Theme-aware soft shadows. Border hairlines still come from `t.line`. */
export function shadow(t: Theme, level: 'xs' | 'sm' | 'md' | 'lg' | 'glow'): ViewStyle {
  if (level === 'glow') {
    return {
      shadowColor: t.glow,
      shadowOpacity: t.isDark ? 0.5 : 0.35,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 5 },
      elevation: 12,
    };
  }
  const table = {
    xs: { opacity: t.isDark ? 0.3 : 0.05, radius: 5, y: 2, elevation: 1 },
    sm: { opacity: t.isDark ? 0.35 : 0.08, radius: 9, y: 4, elevation: 3 },
    md: { opacity: t.isDark ? 0.4 : 0.12, radius: 14, y: 7, elevation: 7 },
    // floating layers (nav bar, sheets, toast): tight offset + wide blur reads
    // as ambient depth instead of a hard drop that the viewport edge clips off
    lg: { opacity: t.isDark ? 0.55 : 0.18, radius: 24, y: 8, elevation: 12 },
  }[level];
  return {
    shadowColor: t.shadow,
    shadowOpacity: table.opacity,
    shadowRadius: table.radius,
    shadowOffset: { width: 0, height: table.y },
    elevation: table.elevation,
  };
}

/** Shared spring characters — snappy for touch feedback, soft for layout moves. */
export const SPRING = {
  snappy: { friction: 6, tension: 300 },
  soft: { friction: 7, tension: 170 },
} as const;
