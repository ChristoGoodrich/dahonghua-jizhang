import React from 'react';
import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { RAD, shadow } from '@/theme/tokens';
import { GradientFill } from './GradientFill';
import { Tap } from './Tap';

interface Props {
  label: string;
  onPress: () => void;
  /** primary = accent gradient · ghost = outlined card · quiet = borderless text */
  variant?: 'primary' | 'ghost' | 'quiet';
  /** Text/icon color override for ghost buttons (e.g. destructive red). */
  tone?: string;
  /** Gradient stops override for primary (defaults to the theme accent). */
  gradient?: [string, string];
  leading?: React.ReactNode;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

/** The app's one button. Primary carries the accent gradient + glow. */
export function Btn({ label, onPress, variant = 'primary', tone, gradient, leading, disabled, style, accessibilityLabel }: Props) {
  const t = useTheme();
  const primary = variant === 'primary';
  const color = primary ? '#fff' : tone ?? t.hibiscus;
  const [gFrom, gTo] = gradient ?? [t.gradFrom, t.gradTo];
  return (
    <Tap
      onPress={onPress}
      disabled={disabled}
      scaleTo={0.97}
      haptic={primary}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        styles.btn,
        variant === 'ghost' && [styles.ghost, { borderColor: t.line, backgroundColor: t.card }],
        primary && [shadow(t, 'glow'), { shadowColor: gTo }],
        disabled && { opacity: 0.45 },
        style,
      ]}
    >
      {primary && <GradientFill from={gFrom} to={gTo} radius={RAD.sm} />}
      {leading}
      <Text style={[styles.text, variant === 'quiet' && styles.quietText, { color }]}>{label}</Text>
    </Tap>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: RAD.sm,
    paddingVertical: 14,
    paddingHorizontal: 18,
    overflow: 'hidden',
  },
  ghost: { borderWidth: 1, paddingVertical: 12 },
  text: { fontSize: 15, fontWeight: '700' },
  quietText: { fontSize: 13.5, fontWeight: '600' },
});
