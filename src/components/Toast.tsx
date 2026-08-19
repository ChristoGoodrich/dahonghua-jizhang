import React, { useEffect } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { useAnimatedValue } from '@/hooks/useAnimatedValue';
import { useTheme } from '@/theme/ThemeContext';
import { Glass } from './ui/Glass';
import { SPRING, shadow } from '@/theme/tokens';
import { Flower } from './Flower';

interface Props {
  message: string;
  // Optional action (e.g. "Undo"). When present the toast lingers and is tappable.
  actionLabel?: string;
  onAction?: () => void;
  /** Distance from the screen bottom (host adjusts for nav bar + insets). */
  bottom?: number;
}

// Mount with a fresh `key` to (re)trigger the show/hide animation.
export function Toast({ message, actionLabel, onAction, bottom = 104 }: Props) {
  const t = useTheme();
  const o = useAnimatedValue(0);
  const interactive = !!actionLabel;

  useEffect(() => {
    Animated.spring(o, { toValue: 1, useNativeDriver: true, ...SPRING.soft }).start();
    const id = setTimeout(
      () => Animated.timing(o, { toValue: 0, duration: 300, useNativeDriver: true }).start(),
      interactive ? 4200 : 1700,
    );
    return () => clearTimeout(id);
  }, [o, interactive]);

  return (
    <Animated.View
      pointerEvents={interactive ? 'box-none' : 'none'}
      style={[
        styles.toastShadow,
        { bottom },
        shadow(t, 'lg'),
        {
          opacity: o.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }),
          transform: [
            { translateY: o.interpolate({ inputRange: [0, 1], outputRange: [26, 0], extrapolate: 'clamp' }) },
            { scale: o.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
          ],
        },
      ]}
    >
      {/* 柔光玻璃 as *dark* glass: the pill keeps its ink surface, so white text
          holds its contrast over a garden or a full list, and gains the blur,
          the lit rim and the ambient pull. density 0.7 because it can appear
          over anything — readability wins over transparency here. */}
      <Glass
        level="chrome"
        surface={t.ink}
        under={t.paper}
        density={0.7}
        style={styles.toast}
        pointerEvents="box-none"
      >
        <Flower size={18} petal="#fff" stamen="#fff" />
        <Text style={[styles.text, { color: t.paper }]}>{message}</Text>
        {interactive && (
          <Pressable testID="toast-action" onPress={onAction} hitSlop={10} accessibilityRole="button" accessibilityLabel={actionLabel}>
            <Text style={[styles.action, { color: t.hibiscusSoft }]}>{actionLabel}</Text>
          </Pressable>
        )}
      </Glass>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // shadow + placement on a plain wrapper; Glass clips its own layers
  toastShadow: {
    position: 'absolute',
    alignSelf: 'center',
    borderRadius: 24,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 20,
    borderRadius: 24,
  },
  text: { fontSize: 13.5, fontWeight: '600' },
  action: { fontSize: 13.5, fontWeight: '800', marginLeft: 4 },
});
