import React, { useRef } from 'react';
import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { SPRING } from '@/theme/tokens';
import { tapHaptic } from '@/util/haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props extends Omit<PressableProps, 'style'> {
  /** Scale while pressed. Rows ~0.98, chips/keys ~0.94, big buttons ~0.97. */
  scaleTo?: number;
  /** Fire a light haptic on press. */
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/** Pressable with a springy scale-down — the app-wide touch feedback. */
export function Tap({ scaleTo = 0.96, haptic, style, onPress, onPressIn, onPressOut, children, ...rest }: Props) {
  const v = useRef(new Animated.Value(1)).current;
  const to = (x: number) =>
    Animated.spring(v, { toValue: x, useNativeDriver: true, ...SPRING.snappy }).start();
  return (
    <AnimatedPressable
      {...rest}
      onPress={(e) => {
        if (haptic) tapHaptic();
        onPress?.(e);
      }}
      onPressIn={(e) => {
        to(scaleTo);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(1);
        onPressOut?.(e);
      }}
      style={[style, { transform: [{ scale: v }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}
