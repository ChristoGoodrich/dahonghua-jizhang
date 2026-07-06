import React, { useId } from 'react';
import { Platform, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

interface Props {
  from: string;
  to: string;
  /** Gradient direction; diagonal reads best on buttons and cards. */
  direction?: 'diagonal' | 'vertical';
  opacity?: number;
}

/** Absolute-fill SVG gradient — no extra native deps.
 *  A unit viewBox stretched with preserveAspectRatio="none" keeps the fill
 *  deterministic on every platform: percentage sizes resolve inconsistently
 *  (web defaults the viewport to 300×150; Android under-resolves against the
 *  measured box), but a 1×1 rect scaled by the viewBox cannot drift. Rounded
 *  corners come from the parent's borderRadius + overflow:hidden. */
export function GradientFill({ from, to, direction = 'diagonal', opacity = 1 }: Props) {
  // web renders all SVG ids in one namespace — make each instance unique
  const id = 'g' + useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <Svg
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      style={[StyleSheet.absoluteFill, styles.under]}
      pointerEvents="none"
    >
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2={direction === 'diagonal' ? '1' : '0'} y2="1">
          <Stop offset="0" stopColor={from} stopOpacity={opacity} />
          <Stop offset="1" stopColor={to} stopOpacity={opacity} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="1" height="1" fill={`url(#${id})`} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  // web: absolutely-positioned layers paint over unpositioned sibling <svg>
  // icons regardless of DOM order, so push the fill below them. Native stacks
  // by declaration order already — and Android maps negative zIndex to
  // translationZ, which would hide the layer — so only the web needs this.
  under: Platform.OS === 'web' ? { zIndex: -1 } : {},
});
