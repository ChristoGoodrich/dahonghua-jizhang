import { useWindowDimensions } from 'react-native';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

const BREAKPOINTS = { tablet: 768, desktop: 1024 };

export interface ResponsiveLayout {
  width: number;
  height: number;
  breakpoint: Breakpoint;
  isTablet: boolean;
  isDesktop: boolean;
  isLandscape: boolean;
  columns: number;
  maxContentWidth: number;
  fontSize: {
    title: number;
    body: number;
    caption: number;
  };
}

export function useResponsive(): ResponsiveLayout {
  const { width, height } = useWindowDimensions();

  const breakpoint: Breakpoint =
    width >= BREAKPOINTS.desktop ? 'desktop' : width >= BREAKPOINTS.tablet ? 'tablet' : 'mobile';

  const isTablet = breakpoint === 'tablet';
  const isDesktop = breakpoint === 'desktop';
  const isLandscape = width > height;

  const columns = isDesktop ? 3 : isTablet ? 2 : 1;
  const maxContentWidth = isDesktop ? 960 : isTablet ? 720 : 480;

  const fontSize = {
    title: isTablet || isDesktop ? 22 : 19,
    body: isTablet || isDesktop ? 16 : 14.5,
    caption: isTablet || isDesktop ? 13 : 11.5,
  };

  return { width, height, breakpoint, isTablet, isDesktop, isLandscape, columns, maxContentWidth, fontSize };
}
