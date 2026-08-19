import React, { useEffect, useRef } from 'react';
import { View, Pressable, StyleSheet, Animated, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAnimatedValue } from '@/hooks/useAnimatedValue';
import { useTheme } from '@/theme/ThemeContext';
import { GradientFill } from '@/components/ui/GradientFill';
import { Icon } from '@/components/ui/Icon';
import { Tap } from '@/components/ui/Tap';
import { Glass } from '@/components/ui/Glass';
import { glassSpec } from '@/theme/glass';
import { shadow } from '@/theme/tokens';
import { I18N, type Lang } from '@/i18n';
import { tapHaptic } from '@/util/haptics';
import { NavIcon } from './NavIcon';

// 明细 / 统计 are the two reading views of the ledger; 资产 / 我的 are the two
// hubs (money you hold · everything else). The calendar moved into 明细's own
// header toggle and the garden into 我的, which freed these two slots.
export type NavKey = 'list' | 'stats' | 'assets' | 'me';

const ORDER: NavKey[] = ['list', 'stats', 'assets', 'me'];

const NAV_TEST_ID: Record<NavKey, string> = {
  list: 'nav-list',
  stats: 'nav-stats',
  assets: 'nav-assets',
  me: 'nav-wall',
};

const PILL_W = 46;
const MARGIN = 16; // outer gutter
const MAX_W = 448; // bar + button, combined
const PAD = 8; // bar paddingHorizontal
const BORDER = 1; // bar borderWidth
const RADIUS = 26;
// The record button is its own capsule beside the bar (iOS 26 style) rather
// than a notch cut into it: the bar stays one uninterrupted glass slab, and
// the primary action gets to be a separate object with its own weight.
const ADD = 60;
const ADD_GAP = 10;
// the lit edge of a glass slab — white on light, a dim rim on dark

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
      testID={NAV_TEST_ID[k]}
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
  /** The primary action — the record button that sits beside the bar. */
  onAdd: () => void;
  lang: Lang;
}

/** Bottom padding under the floating bar — respects the gesture/home inset. */
export function useNavBottomPad(): number {
  const insets = useSafeAreaInsets();
  return Math.max(16, insets.bottom + 6);
}

export function BottomNav({ active, onChange, onAdd, lang }: Props) {
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
  const rowW = Math.min(screenW - 2 * MARGIN, MAX_W);
  const barW = rowW - ADD - ADD_GAP;
  const innerW = barW - 2 * BORDER - 2 * PAD; // flex content width
  const itemW = innerW / 4;
  // in the indicator's (padding-box) coordinate space
  const centerOf = (i: number) => PAD + i * itemW + itemW / 2;
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
      <View style={[styles.row, { width: rowW }]}>
        <View style={[styles.barShadow, { width: barW }, shadow(t, 'sm')]}>
        {/* 柔光玻璃, chrome level: the bar floats over the ledger, so it blends
            toward the page paper and carries enough body for the tab labels to
            stay legible over a full month of entries. */}
        <Glass level="chrome" under={t.paper} density={0.45} style={styles.bar}>
          <Animated.View
            style={[
              styles.indicator,
              {
                backgroundColor: t.hibiscus + (t.isDark ? '2E' : '1F'),
                borderColor: t.hibiscus + (t.isDark ? '4D' : '38'),
                transform: [
                  { translateX: tx },
                  { scaleX: stretch.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] }) },
                ],
              },
            ]}
            pointerEvents="none"
          />
          {ORDER.map(item)}
        </Glass>
        </View>

        {/* Same material as the bar — glass edge, top sheen, matching height —
            but filled with the accent so it still reads as the one primary act. */}
        <Tap
          testID="fab-add"
          onPress={onAdd}
          haptic
          feedback="both"
          scaleTo={0.9}
          accessibilityRole="button"
          accessibilityLabel={s.a11yAdd}
          style={[
            styles.add,
            { backgroundColor: t.hibiscus, borderColor: glassSpec(t, 'chrome').edge },
            shadow(t, 'glow'),
          ]}
        >
          <GradientFill from={t.gradFrom} to={t.gradTo} />
          <View style={styles.addSheen} pointerEvents="none">
            <GradientFill from="#FFFFFF" to="#FFFFFF" direction="vertical" opacity={0.34} toOpacity={0} above />
          </View>
          <Icon name="plus" color="#fff" size={26} strokeWidth={2.4} />
        </Tap>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: ADD_GAP },
  add: {
    width: ADD, height: ADD, borderRadius: ADD / 2, borderWidth: BORDER,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  addSheen: { position: 'absolute', top: 0, left: 0, right: 0, height: ADD / 2 },
  // shadow lives on a plain wrapper: a shadow on the blur view itself would be
  // clipped by its own overflow:hidden (needed to round the blur)
  barShadow: { borderRadius: RADIUS },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 64,
    borderRadius: RADIUS,
    paddingHorizontal: PAD,
  },
  indicator: {
    position: 'absolute', left: 0, top: 10, width: PILL_W, height: 30,
    borderRadius: 15, borderWidth: StyleSheet.hairlineWidth,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', height: '100%', gap: 2 },
  iconWrap: { alignItems: 'center', justifyContent: 'center', width: 40, height: 26 },
  iconOverlay: { position: 'absolute', top: 0, left: 0 },
  label: { fontSize: 10, fontWeight: '800', letterSpacing: 0.2 },
});
