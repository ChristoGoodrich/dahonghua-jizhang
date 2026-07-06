import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeContext';
import { RAD, SPRING, shadow } from '@/theme/tokens';

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
  const enter = useRef(new Animated.Value(0)).current;

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
            styles.sheet,
            { backgroundColor: t.paper, paddingBottom: Math.max(32, insets.bottom + 18) },
            shadow(t, 'lg'),
            {
              opacity: enter.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }),
              transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [56, 0], extrapolate: 'clamp' }) }],
            },
          ]}
        >
          <View style={[styles.grip, { backgroundColor: t.line }]} />
          {children}
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 60, elevation: 60 },
  mask: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheetWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  sheet: {
    maxWidth: 480, width: '100%',
    borderTopLeftRadius: RAD.xl, borderTopRightRadius: RAD.xl,
    padding: 22, paddingBottom: 32,
  },
  grip: { width: 40, height: 4.5, borderRadius: 4, alignSelf: 'center', marginBottom: 14 },
});
