import React from 'react';
import Svg, { Circle, Line, Path } from 'react-native-svg';

export type IconName =
  | 'search' | 'close' | 'sliders' | 'globe'
  | 'chevL' | 'chevR' | 'plus' | 'minus'
  | 'trash' | 'edit' | 'check' | 'swap'
  | 'sun' | 'moon' | 'sparkle' | 'receipt' | 'undo'
  // hub rows — one stroke voice instead of a wall of mismatched emoji
  | 'sprout' | 'bolt' | 'tag' | 'repeat' | 'download' | 'bell'
  | 'cloud' | 'archive' | 'mail' | 'wallet' | 'card' | 'layers';

interface Props {
  name: IconName;
  color: string;
  size?: number;
  strokeWidth?: number;
}

/** Hand-drawn line icons in the same stroke voice as NavIcon — replaces the
 *  emoji-as-icon usage (🔍 ✕ ⚙︎ 🗑 ✏️ …) with crisp, theme-colored glyphs. */
export function Icon({ name, color, size = 20, strokeWidth = 1.8 }: Props) {
  const line = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'search' && (
        <>
          <Circle cx={11} cy={11} r={6.2} {...line} />
          <Line x1={15.8} y1={15.8} x2={20} y2={20} {...line} />
        </>
      )}
      {name === 'close' && (
        <>
          <Line x1={6.5} y1={6.5} x2={17.5} y2={17.5} {...line} />
          <Line x1={17.5} y1={6.5} x2={6.5} y2={17.5} {...line} />
        </>
      )}
      {name === 'sliders' && (
        <>
          <Line x1={4.5} y1={7.5} x2={6.9} y2={7.5} {...line} />
          <Line x1={12.1} y1={7.5} x2={19.5} y2={7.5} {...line} />
          <Line x1={4.5} y1={16.5} x2={11.9} y2={16.5} {...line} />
          <Line x1={17.1} y1={16.5} x2={19.5} y2={16.5} {...line} />
          <Circle cx={9.5} cy={7.5} r={2.4} {...line} />
          <Circle cx={14.5} cy={16.5} r={2.4} {...line} />
        </>
      )}
      {name === 'globe' && (
        <>
          <Circle cx={12} cy={12} r={8} {...line} />
          <Line x1={4} y1={12} x2={20} y2={12} {...line} />
          <Path d="M12 4 C8.8 8 8.8 16 12 20 C15.2 16 15.2 8 12 4 Z" {...line} />
        </>
      )}
      {name === 'chevL' && <Path d="M14.5 5.5 L8 12 L14.5 18.5" {...line} />}
      {name === 'chevR' && <Path d="M9.5 5.5 L16 12 L9.5 18.5" {...line} />}
      {name === 'plus' && (
        <>
          <Line x1={12} y1={5} x2={12} y2={19} {...line} />
          <Line x1={5} y1={12} x2={19} y2={12} {...line} />
        </>
      )}
      {name === 'minus' && <Line x1={5.5} y1={12} x2={18.5} y2={12} {...line} />}
      {name === 'trash' && (
        <>
          <Path d="M5.5 7 H18.5" {...line} />
          <Path d="M9.5 7 V5.2 A1.2 1.2 0 0 1 10.7 4 H13.3 A1.2 1.2 0 0 1 14.5 5.2 V7" {...line} />
          <Path d="M7 7 L7.8 18.2 A1.8 1.8 0 0 0 9.6 19.8 H14.4 A1.8 1.8 0 0 0 16.2 18.2 L17 7" {...line} />
          <Line x1={10.2} y1={10.5} x2={10.5} y2={16.3} {...line} />
          <Line x1={13.8} y1={10.5} x2={13.5} y2={16.3} {...line} />
        </>
      )}
      {name === 'edit' && (
        <>
          <Path d="M13.8 5.8 L18.2 10.2 L9.4 19 L4.6 19.4 L5 14.6 Z" {...line} />
          <Line x1={12.2} y1={7.4} x2={16.6} y2={11.8} {...line} />
        </>
      )}
      {name === 'check' && <Path d="M5 12.5 L10 17.5 L19 6.5" {...line} />}
      {name === 'swap' && (
        <>
          <Path d="M7.5 4.5 L4 8 L7.5 11.5" {...line} />
          <Line x1={4} y1={8} x2={19} y2={8} {...line} />
          <Path d="M16.5 12.5 L20 16 L16.5 19.5" {...line} />
          <Line x1={20} y1={16} x2={5} y2={16} {...line} />
        </>
      )}
      {name === 'sun' && (
        <>
          <Circle cx={12} cy={12} r={4.2} {...line} />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
            const a = (deg * Math.PI) / 180;
            return (
              <Line
                key={deg}
                x1={12 + 6.6 * Math.cos(a)} y1={12 + 6.6 * Math.sin(a)}
                x2={12 + 8.6 * Math.cos(a)} y2={12 + 8.6 * Math.sin(a)}
                {...line}
              />
            );
          })}
        </>
      )}
      {name === 'moon' && (
        <Path d="M19 14.5 A8 8 0 0 1 9.5 5 A8 8 0 1 0 19 14.5 Z" {...line} />
      )}
      {name === 'receipt' && (
        <>
          <Path d="M6.5 3.5 H17.5 V17.5 L15.7 19.5 L13.8 17.7 L12 19.5 L10.2 17.7 L8.3 19.5 L6.5 17.5 Z" {...line} />
          <Line x1={9.5} y1={8} x2={14.5} y2={8} {...line} />
          <Line x1={9.5} y1={11.5} x2={14.5} y2={11.5} {...line} />
        </>
      )}
      {name === 'undo' && (
        <>
          <Path d="M8.5 5 L4.5 9 L8.5 13" {...line} />
          <Path d="M4.5 9 H14 A5.5 5.5 0 0 1 14 20 H8" {...line} />
        </>
      )}
      {name === 'sprout' && (
        <>
          <Path d="M12 20 V11" {...line} />
          <Path d="M12 11 C12 7.5 9.5 5.5 6 5.5 C6 9 8.5 11 12 11 Z" {...line} />
          <Path d="M12 12.5 C12 9.8 14 8.2 16.8 8.2 C16.8 10.9 14.8 12.5 12 12.5 Z" {...line} />
        </>
      )}
      {name === 'bolt' && <Path d="M13.5 3.5 L6.5 13 H11.5 L10.5 20.5 L17.5 11 H12.5 Z" {...line} />}
      {name === 'tag' && (
        <>
          <Path d="M11.4 4.2 H18.4 A1.4 1.4 0 0 1 19.8 5.6 V12.6 L11.6 20.2 A1.4 1.4 0 0 1 9.6 20.2 L3.8 14.4 A1.4 1.4 0 0 1 3.8 12.4 Z" {...line} />
          <Circle cx={15.6} cy={8.4} r={1.5} {...line} />
        </>
      )}
      {name === 'repeat' && (
        <>
          <Path d="M5 10.5 A6.5 6.5 0 0 1 17.5 8.5" {...line} />
          <Path d="M17.8 4.6 V8.8 H13.6" {...line} />
          <Path d="M19 13.5 A6.5 6.5 0 0 1 6.5 15.5" {...line} />
          <Path d="M6.2 19.4 V15.2 H10.4" {...line} />
        </>
      )}
      {name === 'download' && (
        <>
          <Line x1={12} y1={3.8} x2={12} y2={14.2} {...line} />
          <Path d="M7.8 10.2 L12 14.4 L16.2 10.2" {...line} />
          <Path d="M4.5 16 V18.4 A1.6 1.6 0 0 0 6.1 20 H17.9 A1.6 1.6 0 0 0 19.5 18.4 V16" {...line} />
        </>
      )}
      {name === 'bell' && (
        <>
          <Path d="M6.5 16.5 V11 A5.5 5.5 0 0 1 17.5 11 V16.5 L19 18.5 H5 Z" {...line} />
          <Path d="M10.2 18.5 A2 2 0 0 0 13.8 18.5" {...line} />
        </>
      )}
      {name === 'cloud' && (
        <Path d="M7.5 18.5 A4 4 0 0 1 7.7 10.6 A5.2 5.2 0 0 1 17.4 10.9 A3.9 3.9 0 0 1 17 18.5 Z" {...line} />
      )}
      {name === 'archive' && (
        <>
          <Path d="M4 5.5 H20 V9 H4 Z" {...line} />
          <Path d="M5.4 9 V18 A1.6 1.6 0 0 0 7 19.6 H17 A1.6 1.6 0 0 0 18.6 18 V9" {...line} />
          <Line x1={10} y1={13} x2={14} y2={13} {...line} />
        </>
      )}
      {name === 'mail' && (
        <>
          <Path d="M4 6.5 H20 A1 1 0 0 1 21 7.5 V17 A1 1 0 0 1 20 18 H4 A1 1 0 0 1 3 17 V7.5 A1 1 0 0 1 4 6.5 Z" {...line} />
          <Path d="M3.4 7.2 L12 13.4 L20.6 7.2" {...line} />
        </>
      )}
      {name === 'wallet' && (
        <>
          <Path d="M3.8 7.5 H18.5 A1.7 1.7 0 0 1 20.2 9.2 V17.8 A1.7 1.7 0 0 1 18.5 19.5 H5.5 A1.7 1.7 0 0 1 3.8 17.8 Z" {...line} />
          <Path d="M3.8 10 V6.6 A1.4 1.4 0 0 1 5.2 5.2 H15.5" {...line} />
          <Circle cx={16.4} cy={13.5} r={1.3} {...line} />
        </>
      )}
      {name === 'card' && (
        <>
          <Path d="M3.5 6.5 H20.5 V17.5 H3.5 Z" {...line} />
          <Line x1={3.5} y1={10.2} x2={20.5} y2={10.2} {...line} />
          <Line x1={6.8} y1={14.2} x2={11} y2={14.2} {...line} />
        </>
      )}
      {name === 'layers' && (
        <>
          <Path d="M12 3.6 L20.5 8 L12 12.4 L3.5 8 Z" {...line} />
          <Path d="M4.4 12 L12 15.9 L19.6 12" {...line} />
          <Path d="M4.4 16 L12 19.9 L19.6 16" {...line} />
        </>
      )}
      {name === 'sparkle' && (
        <>
          <Path d="M12 4 C12.6 8 14.5 10.4 18.5 11 C14.5 11.6 12.6 14 12 18 C11.4 14 9.5 11.6 5.5 11 C9.5 10.4 11.4 8 12 4 Z" {...line} />
          <Path d="M18.5 16.5 C18.8 18 19.5 18.9 21 19.2 C19.5 19.5 18.8 20.4 18.5 21.9 C18.2 20.4 17.5 19.5 16 19.2 C17.5 18.9 18.2 18 18.5 16.5 Z" {...line} strokeWidth={strokeWidth * 0.85} />
        </>
      )}
    </Svg>
  );
}
