// Web-only boot params (?tab=stats&sheet=1&noanim=1) — deep links for the web
// build and hooks for headless screenshot verification. Read once at module
// load so component render stays pure; always null on native.
import { Platform } from 'react-native';

const params: URLSearchParams | null =
  Platform.OS === 'web' && typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;

export function bootParam(key: string): string | null {
  return params ? params.get(key) : null;
}

/** Mount entrance animations already settled (virtual-time screenshots freeze rAF mid-flight). */
export const NO_ANIM = bootParam('noanim') === '1';
