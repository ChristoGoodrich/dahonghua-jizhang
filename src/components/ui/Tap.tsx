import React, { useMemo } from 'react';
import { Animated, Platform, Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { useAnimatedValue } from '@/hooks/useAnimatedValue';
import { useTheme } from '@/theme/ThemeContext';
import { SPRING } from '@/theme/tokens';
import { tapHaptic } from '@/util/haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props extends Omit<PressableProps, 'style'> {
  /** Scale while pressed — only applied when `feedback` includes it. */
  scaleTo?: number;
  /** tint = darken/lighten the surface (default) · both = tint + a small squeeze,
   *  for big physical-feeling controls like the FAB. */
  feedback?: 'tint' | 'both';
  /** Fire a light haptic on press. */
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

// how far the press state goes — a whisper on surfaces, a dim on bare glyphs
const TINT = 0.07;
const DIM = 0.5;

/** Pressable with the app-wide touch feedback.
 *
 *  Filled surfaces (rows, cards, buttons, chips) get an ink veil that follows
 *  their own corner radius; bare icons/text with no background dim instead —
 *  a tint rectangle around a naked glyph reads as a stray shadow. Scaling is
 *  opt-in (`feedback="both"`) because shrinking a shadowed card drags its
 *  shadow with it, which is the thing that looked cheap. */
export function Tap({
  scaleTo = 0.96,
  feedback = 'tint',
  haptic,
  style,
  onPress,
  onPressIn,
  onPressOut,
  children,
  // every Tap is a control; callers that are a tab/radio/link override it
  accessibilityRole = 'button',
  ...rest
}: Props) {
  const t = useTheme();
  const v = useAnimatedValue(0); // 0 idle → 1 pressed
  const to = (x: number) =>
    // react-native-web has no native animated module: a native-driven value
    // there simply never reaches the DOM (and spins a rAF loop)
    Animated.spring(v, { toValue: x, useNativeDriver: Platform.OS !== 'web', ...SPRING.snappy }).start();

  // The veil has to trace the target's own corners, so read them off the style.
  const veil = useMemo(() => {
    const f = (StyleSheet.flatten(style) ?? {}) as ViewStyle;
    const bg = f.backgroundColor;
    const filled = bg != null && bg !== 'transparent';
    // a style-set opacity (disabled steppers, dimmed rows) is the caller's —
    // dimming on press would overwrite it, so those keep the veil path off
    const fixedOpacity = f.opacity != null;
    const radii: ViewStyle = {
      borderRadius: f.borderRadius,
      borderTopLeftRadius: f.borderTopLeftRadius,
      borderTopRightRadius: f.borderTopRightRadius,
      borderBottomLeftRadius: f.borderBottomLeftRadius,
      borderBottomRightRadius: f.borderBottomRightRadius,
    };
    return { filled, fixedOpacity, radii };
  }, [style]);

  const scale = feedback === 'both'
    ? { transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, scaleTo] }) }] }
    : null;
  const dim =
    veil.filled || veil.fixedOpacity
      ? null
      : { opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, DIM] }) };

  return (
    <AnimatedPressable
      {...rest}
      accessibilityRole={accessibilityRole}
      onPress={(e) => {
        if (haptic) tapHaptic();
        onPress?.(e);
      }}
      onPressIn={(e) => {
        to(1);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(0);
        onPressOut?.(e);
      }}
      style={[style, scale, dim]}
    >
      {children}
      {veil.filled && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.veil,
            veil.radii,
            { backgroundColor: t.ink, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0, TINT] }) },
          ]}
        />
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  veil: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
});
