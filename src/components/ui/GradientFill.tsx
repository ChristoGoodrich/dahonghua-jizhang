import React, { useId } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

interface Props {
  from: string;
  to: string;
  radius?: number;
  /** Gradient direction; diagonal reads best on buttons and cards. */
  direction?: 'diagonal' | 'vertical';
  opacity?: number;
}

/** Absolute-fill SVG gradient — no extra native deps, works on the web export.
 *  Place as the first child of a container with overflow hidden or a radius. */
export function GradientFill({ from, to, radius = 0, direction = 'diagonal', opacity = 1 }: Props) {
  // On the web all SVG ids share one document namespace, and duplicate ids
  // resolve to the FIRST definition — two fills with the same stops but
  // different opacity would hijack each other. useId is unique per instance
  // and hydration-safe for the static export.
  const id = 'g' + useId().replace(/[^a-zA-Z0-9]/g, '');
  // width/height must be explicit: without them the web <svg> viewport falls
  // back to the SVG default of 300×150, so the "100%" rect only covers part
  // of larger containers (buttons, the summary card wash).
  // zIndex -1: on the web, an absolutely-positioned layer paints over
  // unpositioned siblings (bare SVG icons) regardless of DOM order — keep the
  // fill below every sibling on both platforms.
  return (
    <Svg width="100%" height="100%" style={[StyleSheet.absoluteFill, styles.under]} pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2={direction === 'diagonal' ? '1' : '0'} y2="1">
          <Stop offset="0" stopColor={from} stopOpacity={opacity} />
          <Stop offset="1" stopColor={to} stopOpacity={opacity} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" rx={radius} ry={radius} fill={`url(#${id})`} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  under: { zIndex: -1 },
});
