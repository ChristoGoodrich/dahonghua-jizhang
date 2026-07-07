import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Animated } from 'react-native';
import { useAnimatedValue } from '@/hooks/useAnimatedValue';
import { useTheme } from '@/theme/ThemeContext';
import { Tap } from '@/components/ui/Tap';
import { RAD, TABULAR, shadow } from '@/theme/tokens';
import { Flower } from '@/components/Flower';
import { I18N, daysUnit, flowersUnit, type Lang } from '@/i18n';

/** Staggered bloom — each earned flower pops in with a small spring. */
function Bloom({ index, children }: { index: number; children: React.ReactNode }) {
  const v = useAnimatedValue(0);
  useEffect(() => {
    const id = setTimeout(
      () => Animated.spring(v, { toValue: 1, friction: 5, tension: 180, useNativeDriver: true }).start(),
      Math.min(index * 45, 700),
    );
    return () => clearTimeout(id);
  }, [index, v]);
  return (
    <Animated.View
      style={{
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

interface Props {
  count: number;
  streak: number;
  lang: Lang;
  goal: number;
  onGoalChange: (goal: number) => void;
}

export const GOAL_MIN = 7;
export const GOAL_MAX = 60;
export const GOAL_DEFAULT = 28;
const GOAL_STEP = 7; // one row at a time (the wall is 7 columns wide)

const HUES: { petal?: string; stroke?: string }[] = [
  {},
  { petal: '#E8949E' },
  { petal: '#6FA88F', stroke: '#4E7A68' },
  { petal: '#E0A0C0', stroke: '#B06A8C' },
];

const clampGoal = (g: number) => Math.max(GOAL_MIN, Math.min(GOAL_MAX, g));

export function GardenView({ count, streak, lang, goal, onGoalChange }: Props) {
  const t = useTheme();
  const s = I18N[lang];
  const target = clampGoal(goal || GOAL_DEFAULT);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={[styles.wall, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'sm')]}>
        <View style={styles.top}>
          <Text style={[styles.title, { color: t.ink }]}>{s.wallTitle}</Text>
          <View style={styles.goalRow}>
            <Tap
              onPress={() => onGoalChange(clampGoal(target - GOAL_STEP))}
              disabled={target <= GOAL_MIN}
              hitSlop={8}
              scaleTo={0.85}
              accessibilityRole="button"
              accessibilityLabel={s.wallGoalDown}
              style={[styles.stepper, { borderColor: t.line, backgroundColor: t.paper, opacity: target <= GOAL_MIN ? 0.35 : 1 }]}
            >
              <Text style={[styles.stepperText, { color: t.inkSoft }]}>−</Text>
            </Tap>
            <Text style={[styles.count, TABULAR, { color: t.hibiscus }]}>
              {Math.min(count, target)}/{target} {flowersUnit(lang, target)}
            </Text>
            <Tap
              onPress={() => onGoalChange(clampGoal(target + GOAL_STEP))}
              disabled={target >= GOAL_MAX}
              hitSlop={8}
              scaleTo={0.85}
              accessibilityRole="button"
              accessibilityLabel={s.wallGoalUp}
              style={[styles.stepper, { borderColor: t.line, backgroundColor: t.paper, opacity: target >= GOAL_MAX ? 0.35 : 1 }]}
            >
              <Text style={[styles.stepperText, { color: t.inkSoft }]}>＋</Text>
            </Tap>
          </View>
        </View>
        <Text style={[styles.sub, { color: t.inkSoft }]}>{s.wallSub}</Text>
        <View style={styles.garden}>
          {Array.from({ length: target }).map((_, i) => (
            <View key={i} style={styles.cell}>
              <View style={[styles.slot, { backgroundColor: t.paper }, i >= count && styles.bud]}>
                {i < count ? (
                  <Bloom index={i}>
                    <Flower size={34} {...HUES[i % HUES.length]} />
                  </Bloom>
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
              {s.streakLabel} {streak} {daysUnit(lang, streak)}
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
  wall: { borderRadius: RAD.lg, borderWidth: StyleSheet.hairlineWidth, padding: 18 },
  top: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 },
  title: { fontSize: 15, fontWeight: '700' },
  goalRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepper: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepperText: { fontSize: 15, fontWeight: '700', lineHeight: 18 },
  count: { fontSize: 13, fontWeight: '700', minWidth: 54, textAlign: 'center' },
  sub: { fontSize: 11.5, marginBottom: 14 },
  garden: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 4 },
  slot: { flex: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  bud: { opacity: 0.32 },
  streakWrap: { alignItems: 'center', marginTop: 14 },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 13 },
  streakText: { fontSize: 12.5, fontWeight: '600' },
});
