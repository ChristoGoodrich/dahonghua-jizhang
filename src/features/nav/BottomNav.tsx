import React, { useEffect, useRef } from 'react';
import { View, Pressable, StyleSheet, Animated, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAnimatedValue } from '@/hooks/useAnimatedValue';
import { useTheme } from '@/theme/ThemeContext';
import { shadow } from '@/theme/tokens';
import { I18N, type Lang } from '@/i18n';
import { tapHaptic } from '@/util/haptics';
import { NavIcon } from './NavIcon';

export type NavKey = 'list' | 'cal' | 'stats' | 'wall';

const ORDER: NavKey[] = ['list', 'cal', 'stats', 'wall'];
// Split 2 | (center FAB) | 2 — Cookie-style raised center button.
const LEFT: NavKey[] = ['list', 'cal'];
const RIGHT: NavKey[] = ['stats', 'wall'];

const PILL_W = 46;
const MARGIN = 16; // bar marginHorizontal
const MAX_W = 448; // bar maxWidth
const PAD = 8; // bar paddingHorizontal
const BORDER = 1; // bar borderWidth
const GAP = 74; // center spacer for the FAB

interface ItemProps {
  k: NavKey;
  active: boolean;
  label: string;
  onPress: () => void;
}

function NavItem({ k, active, label, onPress }: ItemProps) {
  const t = useTheme();
  const av = useAnimatedValue(active ? 1 : 0);

  useEffect(() => {
    Animated.spring(av, { toValue: active ? 1 : 0, useNativeDriver: false, friction: 6, tension: 175 }).start();
  }, [active, av]);

  const iconStyle = {
    transform: [
      { scale: av.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) },
      { translateY: av.interpolate({ inputRange: [0, 1], outputRange: [0, -2] }) },
    ],
  };
  const labelColor = av.interpolate({ inputRange: [0, 1], outputRange: [t.inkSoft, t.hibiscus] });

  return (
    <Pressable
      style={styles.item}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <View style={styles.iconWrap}>
        <Animated.View style={iconStyle}>
          <NavIcon name={k} color={t.inkSoft} />
          <Animated.View style={[styles.iconOverlay, { opacity: av }]}>
            <NavIcon name={k} color={t.hibiscus} />
          </Animated.View>
        </Animated.View>
      </View>
      <Animated.Text style={[styles.label, { color: labelColor }]} numberOfLines={1}>
        {label}
      </Animated.Text>
    </Pressable>
  );
}

interface Props {
  active: NavKey;
  onChange: (k: NavKey) => void;
  lang: Lang;
}

/** Bottom padding under the floating bar — respects the gesture/home inset. */
export function useNavBottomPad(): number {
  const insets = useSafeAreaInsets();
  return Math.max(16, insets.bottom + 6);
}

export function BottomNav({ active, onChange, lang }: Props) {
  const t = useTheme();
  const s = I18N[lang];
  const bottomPad = useNavBottomPad();
  const { width: screenW } = useWindowDimensions();
  const tx = useAnimatedValue(0); // sliding indicator translateX
  const stretch = useAnimatedValue(0); // 0..1 liquid squash-stretch during slide
  const firstRef = useRef(true);
  const activeIdx = ORDER.indexOf(active);

  // Bar width is a deterministic function of screen width (no onLayout needed —
  // it's flaky on the static web export). Compute each tab's icon-center x.
  const barW = Math.min(screenW - 2 * MARGIN, MAX_W);
  const innerW = barW - 2 * BORDER - 2 * PAD; // flex content width
  const itemW = (innerW - GAP) / 4;
  const centerOf = (i: number) => {
    const offset = i < 2 ? i * itemW : i * itemW + GAP; // items 2,3 sit after the center gap
    return PAD + offset + itemW / 2; // in the indicator's (padding-box) coordinate space
  };
  const target = centerOf(activeIdx) - PILL_W / 2;

  useEffect(() => {
    if (firstRef.current) {
      tx.setValue(target); // place instantly on first render
      firstRef.current = false;
      return;
    }
    Animated.spring(tx, { toValue: target, useNativeDriver: false, friction: 7, tension: 170 }).start();
    // brief horizontal stretch then settle — liquid feel
    Animated.sequence([
      Animated.timing(stretch, { toValue: 1, duration: 90, useNativeDriver: false }),
      Animated.spring(stretch, { toValue: 0, friction: 7, tension: 130, useNativeDriver: false }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const press = (k: NavKey) => {
    tapHaptic();
    onChange(k);
  };

  const item = (k: NavKey) => (
    <NavItem key={k} k={k} active={active === k} label={s[k]} onPress={() => press(k)} />
  );

  return (
    <View style={[styles.wrap, { paddingBottom: bottomPad }]} pointerEvents="box-none">
      <View style={[styles.bar, { width: barW, backgroundColor: t.card, borderColor: t.line }, shadow(t, 'lg')]}>
        <Animated.View
          style={[
            styles.indicator,
            {
              backgroundColor: t.tintStrong,
              transform: [
                { translateX: tx },
                { scaleX: stretch.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] }) },
              ],
            },
          ]}
          pointerEvents="none"
        />
        {LEFT.map(item)}
        <View style={styles.gap} />
        {RIGHT.map(item)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 64,
    borderRadius: 26,
    borderWidth: BORDER,
    paddingHorizontal: PAD,
  },
  indicator: { position: 'absolute', left: 0, top: 10, width: PILL_W, height: 30, borderRadius: 15 },
  gap: { width: GAP },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', height: '100%', gap: 2 },
  iconWrap: { alignItems: 'center', justifyContent: 'center', width: 40, height: 26 },
  iconOverlay: { position: 'absolute', top: 0, left: 0 },
  label: { fontSize: 10, fontWeight: '800', letterSpacing: 0.2 },
});
