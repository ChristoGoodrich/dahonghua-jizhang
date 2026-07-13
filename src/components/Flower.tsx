// Flower — react-native-svg port of v7's flower() generator.
// Five rotated petals around a center that can be a stamen dot, a ￥ glyph,
// or a little face. Colors default to the brand palette but are overridable.
import React from 'react';
import Svg, { G, Ellipse, Circle, Path, Text as SvgText } from 'react-native-svg';

export type FlowerCenter = 'stamen' | 'yen' | 'face';

export interface FlowerProps {
  size: number;
  petal?: string;
  stamen?: string;
  stroke?: string;
  center?: FlowerCenter;
}

const PETALS = [
  { cx: 50, cy: 26, rot: 0 },
  { cx: 73, cy: 42, rot: 72 },
  { cx: 64, cy: 70, rot: 144 },
  { cx: 36, cy: 70, rot: 216 },
  { cx: 27, cy: 42, rot: 288 },
];

export function Flower({
  size,
  petal = '#D94E5C',
  stamen = '#E8A838',
  stroke = '#B83A48',
  center = 'stamen',
}: FlowerProps) {
  return (
    <Svg viewBox="0 0 100 100" width={size} height={size}>
      <G fill={petal}>
        {PETALS.map((p, i) => (
          <Ellipse
            key={i}
            cx={p.cx}
            cy={p.cy}
            rx={18}
            ry={20}
            // SVG-standard transform string: rotation/origin props render as a
            // `transform-origin` DOM attribute on web, which React DOM rejects
            transform={`rotate(${p.rot} ${p.cx} ${p.cy})`}
          />
        ))}
      </G>
      {center === 'yen' && (
        <SvgText
          x={50}
          y={59}
          fontSize={27}
          fontWeight="800"
          fill={stroke}
          textAnchor="middle"
        >
          ￥
        </SvgText>
      )}
      {center === 'face' && (
        <>
          <Circle cx={50} cy={50} r={15} fill="#fff" />
          <Circle cx={44} cy={49} r={2.3} fill={stroke} />
          <Circle cx={56} cy={49} r={2.3} fill={stroke} />
          <Path d="M44 54 Q50 60 56 54" stroke={stroke} strokeWidth={2.4} fill="none" strokeLinecap="round" />
        </>
      )}
      {center === 'stamen' && <Circle cx={50} cy={50} r={13} fill={stamen} />}
    </Svg>
  );
}

// muted "bud" flower used for empty/unfilled slots (matches v7's #E0CDB8 bud)
export function BudFlower({ size }: { size: number }) {
  return <Flower size={size} petal="#E0CDB8" stamen="#D6C3AC" />;
}
