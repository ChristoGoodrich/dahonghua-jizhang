// Design tokens — ported from the v7 prototype's CSS custom properties,
// including the four flower themes and dark-mode surface overrides.
import type { ThemeKey } from '@/domain/types';

export interface Theme {
  hibiscus: string;
  hibiscusDeep: string;
  hibiscusSoft: string;
  stamen: string;
  leaf: string;
  leafDeep: string;
  paper: string;
  paperWarm: string;
  ink: string;
  inkSoft: string;
  line: string;
  card: string;
  isDark: boolean;
}

const BASE = {
  hibiscus: '#D94E5C', hibiscusDeep: '#B83A48', hibiscusSoft: '#EC9AA2',
  stamen: '#E8A838', leaf: '#6FA88F', leafDeep: '#4E7A68',
  paper: '#FBF7F0', paperWarm: '#F6EEE2', ink: '#2B2622', inkSoft: '#8A8178',
  line: '#EADFCF', card: '#FFFFFF',
};

// accent overrides per theme (from body[data-theme=...])
const THEME_ACCENTS: Record<ThemeKey, Partial<typeof BASE>> = {
  default: {},
  sakura: { hibiscus: '#E8869B', hibiscusDeep: '#C76482', hibiscusSoft: '#F2B3C4', stamen: '#E8A838' },
  daisy: { hibiscus: '#E0A93C', hibiscusDeep: '#BC8A26', hibiscusSoft: '#F0CE84', stamen: '#D94E5C' },
  jasmine: { hibiscus: '#7C9C8F', hibiscusDeep: '#5C7C6F', hibiscusSoft: '#A8C2B8', stamen: '#E8A838' },
};

// surface overrides for dark mode (accent is kept)
const DARK_SURFACES = {
  paper: '#1C1A18', paperWarm: '#262320', ink: '#F0EAE2', inkSoft: '#9A9186',
  line: '#3A3531', card: '#262320',
};

export function makeTheme(themeKey: ThemeKey = 'default', dark = false): Theme {
  return {
    ...BASE,
    ...THEME_ACCENTS[themeKey],
    ...(dark ? DARK_SURFACES : {}),
    isDark: dark,
  };
}

export const THEME_KEYS: ThemeKey[] = ['default', 'sakura', 'daisy', 'jasmine'];

// representative accent swatch for the theme picker
export const THEME_SWATCH: Record<ThemeKey, string> = {
  default: '#D94E5C', sakura: '#E8869B', daisy: '#E0A93C', jasmine: '#7C9C8F',
};
