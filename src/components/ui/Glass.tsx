import React, { useMemo } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '@/theme/ThemeContext';
import { GradientFill } from './GradientFill';
import {
  glassSpec,
  readabilityAlpha,
  resolveTier,
  touchLightColor,
  washColor,
  type GlassLevel,
  type GlassTier,
} from '@/theme/glass';

interface Props {
  /** Depth in the stack — chrome floats over content, sheet covers it, card
   *  rests in it. Drives blur, wash and sheen together. */
  level?: GlassLevel;
  /** The colour this surface sits over. The wash blends toward it so the
   *  material picks up the room instead of frosting neutrally over it. */
  under?: string;
  /** The material's own colour, before it picks up the room. Defaults to the
   *  card colour; dark chrome (the toast pill) passes `t.ink` so it stays dark
   *  glass instead of becoming a light panel white text falls off. */
  surface?: string;
  /** How busy the content behind is, 0–1. Higher pushes the wash more opaque
   *  so labels on the glass keep resolving. Default 0.35 suits a typical
   *  ledger screen; pass 0 over empty paper, 1 over dense text. */
  density?: number;
  /** Force a tier. Omit to detect (web falls back to `wash`). */
  tier?: GlassTier;
  /** Hairline along the lit edge. On by default — it is most of what reads as
   *  an edge of glass rather than a flat panel. */
  edge?: boolean;
  /** Specular highlight along the top. On by default. */
  sheen?: boolean;
  /** Animated 0–1 driving the touch bloom (see touchLightColor). */
  touch?: Animated.AnimatedInterpolation<number> | Animated.Value;
  /** Colour of the touch bloom; defaults to the theme's. */
  touchColor?: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
}

/**
 * 柔光玻璃 — the app's soft-light glass surface.
 *
 * One material, three behaviours, matching how HyperOS 4 describes it: the wash
 * blends toward what is underneath (`under`), its opacity answers how busy that
 * content is (`density`), and a touch raises a specular bloom (`touch`). See
 * `src/theme/glass.ts` for what is Xiaomi's stated behaviour and what is our
 * reading of it.
 *
 * Below the `full` tier the blur drops out and the wash thickens to compensate.
 * That is a designed state, not a failure: HyperOS gates the effect on flagship
 * silicon, and everything under it still has to look deliberate.
 *
 * Corner radius belongs to the caller via `style` — the layers inside inherit
 * it through `overflow: hidden`, so a radius set here would fight the parent.
 */
export function Glass({
  level = 'chrome',
  under,
  surface,
  density = 0.35,
  tier: tierProp,
  edge = true,
  sheen = true,
  touch,
  touchColor,
  style,
  children,
  pointerEvents,
}: Props) {
  const t = useTheme();
  const tier = tierProp ?? resolveTier();
  const spec = glassSpec(t, level);

  const wash = useMemo(
    () => washColor(t, level, under, readabilityAlpha(t, level, density, tier), surface),
    [t, level, under, density, tier, surface],
  );

  const border = edge ? { borderWidth: spec.edgeWidth, borderColor: spec.edge } : null;

  const body = (
    <>
      {/* the material itself: our own surface colour, pulled toward the room */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: wash }]} pointerEvents="none" />

      {/* specular top edge — the single cue that reads as "glass" rather than
          "translucent panel" */}
      {sheen && spec.sheen > 0 && (
        <View style={[styles.sheen, { height: spec.sheenHeight }]} pointerEvents="none">
          <GradientFill
            from="#FFFFFF"
            to="#FFFFFF"
            direction="vertical"
            opacity={spec.sheen}
            toOpacity={0}
            above
          />
        </View>
      )}

      {/* 感知交互行为 — bloom driven by the caller's press animation */}
      {touch && (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: touchColor ?? touchLightColor(t), opacity: touch },
          ]}
          pointerEvents="none"
        />
      )}

      {children}
    </>
  );

  if (tier === 'full') {
    return (
      <BlurView
        intensity={spec.intensity}
        tint={t.isDark ? 'dark' : 'light'}
        // Android has no free backdrop blur; this is the opt-in real one
        experimentalBlurMethod="dimezisBlurView"
        style={[styles.base, border, style]}
        pointerEvents={pointerEvents}
      >
        {body}
      </BlurView>
    );
  }

  // wash / solid: same composition, no compositing layer
  return (
    <View style={[styles.base, border, style]} pointerEvents={pointerEvents}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { overflow: 'hidden' },
  sheen: { position: 'absolute', top: 0, left: 0, right: 0 },
});
