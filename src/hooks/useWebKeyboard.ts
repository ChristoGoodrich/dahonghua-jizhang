import { useEffect } from 'react';
import { Platform } from 'react-native';

type ShortcutMap = Record<string, () => void>;

export function useWebKeyboard(shortcuts: ShortcutMap) {
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (e.key === 'Escape') {
          // Allow Escape even in inputs
        } else {
          return;
        }
      }

      const fn = shortcuts[e.key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shortcuts]);
}
