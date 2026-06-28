import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from '@/components/Flower';
import { I18N, type Lang } from '@/i18n';

interface Props {
  count: number;
  streak: number;
  lang: Lang;
}

const GOAL = 28;
const HUES: { petal?: string; stroke?: string }[] = [
  {},
  { petal: '#E8949E' },
  { petal: '#6FA88F', stroke: '#4E7A68' },
  { petal: '#E0A0C0', stroke: '#B06A8C' },
];

export function GardenView({ count, streak, lang }: Props) {
  const t = useTheme();
  const s = I18N[lang];

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={[styles.wall, { backgroundColor: t.card }]}>
        <View style={styles.top}>
          <Text style={[styles.title, { color: t.ink }]}>{s.wallTitle}</Text>
          <Text style={[styles.count, { color: t.hibiscus }]}>
            {Math.min(count, GOAL)}/{GOAL} {s.flowersUnit}
          </Text>
        </View>
        <Text style={[styles.sub, { color: t.inkSoft }]}>{s.wallSub}</Text>
        <View style={styles.garden}>
          {Array.from({ length: GOAL }).map((_, i) => (
            <View key={i} style={styles.cell}>
              <View style={[styles.slot, { backgroundColor: t.paper }, i >= count && styles.bud]}>
                {i < count ? (
                  <Flower size={34} {...HUES[i % HUES.length]} />
                ) : (
                  <Flower size={34} petal="#E0CDB8" stamen="#D6C3AC" />
                )}
              </View>
            </View>
          ))}
        </View>
        <View style={styles.streakWrap}>
          <View style={[styles.streak, { backgroundColor: t.paperWarm, borderColor: t.line }]}>
            <Flower size={16} />
            <Text style={[styles.streakText, { color: t.ink }]}>
              {s.streakLabel} {streak} {s.daysUnit}
            </Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 22, paddingTop: 6, paddingBottom: 140 },
  wall: { borderRadius: 16, padding: 18 },
  top: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 },
  title: { fontSize: 15, fontWeight: '700' },
  count: { fontSize: 13, fontWeight: '700' },
  sub: { fontSize: 11.5, marginBottom: 14 },
  garden: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 4 },
  slot: { flex: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  bud: { opacity: 0.32 },
  streakWrap: { alignItems: 'center', marginTop: 14 },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 13 },
  streakText: { fontSize: 12.5, fontWeight: '600' },
});
