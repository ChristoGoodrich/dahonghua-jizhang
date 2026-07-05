import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { G, Circle } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeContext';
import { TABULAR } from '@/theme/tokens';
import { catOf } from '@/domain/cats';
import { donutSlices, type CatTotal } from '@/domain/stats';
import { fmtShort } from '@/domain/money';
import type { Category, IO } from '@/domain/types';
import type { Lang } from '@/i18n';

interface Props {
  cats: CatTotal[]; // sorted desc, already filtered to the active io
  total: number;
  io: IO;
  customCats: Record<IO, Category[]>;
  lang: Lang;
  centerLabel: string; // e.g. "支出" / "收入"
}

const SIZE = 168;
const STROKE = 24;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

export function CategoryDonut({ cats, total, io, customCats, lang, centerLabel }: Props) {
  const t = useTheme();
  if (total <= 0) return null;
  const slices = donutSlices(cats, total);
  const top = slices[0];
  const topCat = top ? catOf(io, top.cat, customCats) : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.chart}>
        <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          {/* track */}
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={t.line} strokeWidth={STROKE} opacity={0.4} />
          <G rotation={-90} originX={SIZE / 2} originY={SIZE / 2}>
            {slices.map((sl) => {
              const color = catOf(io, sl.cat, customCats).c;
              const seg = sl.frac * C;
              return (
                <Circle
                  key={sl.cat}
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={R}
                  fill="none"
                  stroke={color}
                  strokeWidth={STROKE}
                  strokeDasharray={[seg, C - seg]}
                  strokeDashoffset={-sl.start * C}
                  strokeLinecap="butt"
                />
              );
            })}
          </G>
        </Svg>
        <View style={styles.center} pointerEvents="none">
          <Text style={[styles.centerLabel, { color: t.inkSoft }]}>{centerLabel}</Text>
          <Text style={[styles.centerVal, TABULAR, { color: t.ink }]} numberOfLines={1}>{fmtShort(total, lang)}</Text>
          {topCat && (
            <Text style={[styles.centerTop, { color: topCat.c }]} numberOfLines={1}>
              {topCat.e} {Math.round(top.frac * 100)}%
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', marginTop: 14, marginBottom: 2 },
  chart: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  centerLabel: { fontSize: 11, fontWeight: '600' },
  centerVal: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4, marginTop: 2 },
  centerTop: { fontSize: 12, fontWeight: '700', marginTop: 3 },
});
