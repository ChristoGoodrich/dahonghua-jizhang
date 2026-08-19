import React, { useEffect } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAnimatedValue } from '@/hooks/useAnimatedValue';
import { useTheme } from '@/theme/ThemeContext';
import { RAD, SPRING, shadow } from '@/theme/tokens';
import { Glass } from './Glass';

interface Props {
  onClose: () => void;
  /** Spoken label for the dismiss scrim. */
  closeLabel: string;
  children: React.ReactNode;
}

/** Bottom sheet chrome — scrim fade + springy rise, grip, paper surface.
 *  One entrance for every sheet so the app moves with a single voice. */
export function SheetShell({ onClose, closeLabel, children }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const enter = useAnimatedValue(0);

  useEffect(() => {
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, ...SPRING.soft }).start();
  }, [enter]);

  return (
    <View style={styles.overlay}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: enter.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }) }]}
      >
        <Pressable
          style={[styles.mask, { backgroundColor: t.overlay }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
        />
      </Animated.View>
      {/* flex wrapper (not absolute insets on the sheet itself) so maxWidth
          centering holds on wide screens — CSS ignores alignSelf on
          absolutely-positioned elements and pins them left */}
      <View style={styles.sheetWrap} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.sheetShadow,
            shadow(t, 'lg'),
            {
              opacity: enter.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }),
              transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [56, 0], extrapolate: 'clamp' }) }],
            },
          ]}
        >
          {/* 柔光玻璃, sheet level: a sheet covers the ledger rather than
              floating over it, so it carries more body than the nav bar and a
              softer sheen. density 0.6 — whatever it covers is the busiest part
              of the app, and the form on top has to stay readable. */}
          <Glass
            level="sheet"
            under={t.paper}
            density={0.6}
            style={[styles.sheet, { paddingBottom: Math.max(32, insets.bottom + 18) }]}
          >
            <View style={[styles.grip, { backgroundColor: t.line }]} />
            {children}
          </Glass>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 60, elevation: 60 },
  mask: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheetWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  // shadow lives on a plain wrapper: a shadow on the glass surface itself
  // would be clipped by its own overflow:hidden (needed to round the blur).
  // Width and centering live here too, so the shadow traces the same box.
  sheetShadow: {
    maxWidth: 480, width: '100%',
    borderTopLeftRadius: RAD.xl, borderTopRightRadius: RAD.xl,
  },
  sheet: {
    width: '100%',
    borderTopLeftRadius: RAD.xl, borderTopRightRadius: RAD.xl,
    padding: 22, paddingBottom: 32,
  },
  grip: { width: 40, height: 4.5, borderRadius: 4, alignSelf: 'center', marginBottom: 14 },
});
