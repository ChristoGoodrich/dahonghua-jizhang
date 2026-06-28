import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from './Flower';

// Mount with a fresh `key` to (re)trigger the show/hide animation.
export function Toast({ message }: { message: string }) {
  const t = useTheme();
  const o = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(o, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    const id = setTimeout(
      () => Animated.timing(o, { toValue: 0, duration: 300, useNativeDriver: true }).start(),
      1700,
    );
    return () => clearTimeout(id);
  }, [o]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.toast,
        {
          backgroundColor: t.ink,
          opacity: o,
          transform: [{ translateY: o.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
        },
      ]}
    >
      <Flower size={18} petal="#fff" stamen="#fff" />
      <Text style={[styles.text, { color: t.paper }]}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    bottom: 104,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 20,
    borderRadius: 24,
  },
  text: { fontSize: 13.5, fontWeight: '600' },
});
