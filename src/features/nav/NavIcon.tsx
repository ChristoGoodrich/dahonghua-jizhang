import React from 'react';
import Svg, { Rect, Line, Circle } from 'react-native-svg';
import type { NavKey } from './BottomNav';

interface Props {
  name: NavKey;
  color: string;
  size?: number;
}

// Hand-drawn line icons tuned to the app's soft, floral brand — one cohesive
// stroke style, colored by the caller (active = hibiscus, inactive = inkSoft).
export function NavIcon({ name, color, size = 22 }: Props) {
  const sw = 1.8;
  const line = { stroke: color, strokeWidth: sw, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'list' && (
        <>
          <Rect x={4.5} y={3.5} width={15} height={17} rx={3.2} {...line} />
          <Line x1={8} y1={8.5} x2={16} y2={8.5} {...line} />
          <Line x1={8} y1={12} x2={15} y2={12} {...line} />
          <Line x1={8} y1={15.5} x2={12.5} y2={15.5} {...line} />
        </>
      )}

      {name === 'cal' && (
        <>
          <Rect x={4} y={5} width={16} height={15} rx={3.2} {...line} />
          <Line x1={8} y1={3} x2={8} y2={6.5} {...line} />
          <Line x1={16} y1={3} x2={16} y2={6.5} {...line} />
          <Line x1={4} y1={9.5} x2={20} y2={9.5} {...line} />
          <Circle cx={12} cy={14.5} r={1.5} fill={color} stroke="none" />
        </>
      )}

      {name === 'stats' && (
        <>
          <Line x1={7} y1={20} x2={7} y2={13} {...line} strokeWidth={2.6} />
          <Line x1={12} y1={20} x2={12} y2={8} {...line} strokeWidth={2.6} />
          <Line x1={17} y1={20} x2={17} y2={15} {...line} strokeWidth={2.6} />
        </>
      )}

      {name === 'wall' && (
        <>
          {/* five-petal hibiscus — the brand mark */}
          {[-90, -18, 54, 126, 198].map((deg) => {
            const a = (deg * Math.PI) / 180;
            return (
              <Circle key={deg} cx={12 + 4.2 * Math.cos(a)} cy={12 + 4.2 * Math.sin(a)} r={3.4} {...line} />
            );
          })}
          <Circle cx={12} cy={12} r={1.7} fill={color} stroke="none" />
        </>
      )}
    </Svg>
  );
}
