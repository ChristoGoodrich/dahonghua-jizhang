import React, { createContext, useContext, useMemo } from 'react';
import { makeTheme, type Theme } from './tokens';
import type { ThemeKey } from '@/domain/types';

const ThemeCtx = createContext<Theme>(makeTheme());

export const useTheme = () => useContext(ThemeCtx);

export function ThemeProvider({
  themeKey,
  dark,
  children,
}: {
  themeKey: ThemeKey;
  dark: boolean;
  children: React.ReactNode;
}) {
  const theme = useMemo(() => makeTheme(themeKey, dark), [themeKey, dark]);
  return <ThemeCtx.Provider value={theme}>{children}</ThemeCtx.Provider>;
}
