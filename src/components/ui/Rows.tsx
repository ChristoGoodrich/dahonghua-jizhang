import React from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Tap } from '@/components/ui/Tap';
import { Icon } from '@/components/ui/Icon';
import { RAD, shadow } from '@/theme/tokens';

/** A titled card of related rows — the shared building block of the hub tabs
 *  (资产 / 我的) and the settings screen, so every list of options in the app
 *  has the same rhythm instead of one layout per screen. */
export function Group({ title, children, style }: { title?: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[styles.group, style]}>
      {!!title && <Text style={[styles.groupHead, { color: t.inkSoft }]}>{title}</Text>}
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'xs')]}>{children}</View>
    </View>
  );
}

interface RowProps {
  title: string;
  desc?: string;
  /** Leading line glyph — an `<Icon/>` in the accent color, never an emoji:
   *  a column of emoji brings its own clashing palette to every row. */
  lead?: React.ReactNode;
  /** Trailing node — a value, a toggle. Omitted rows that navigate get a chevron. */
  right?: React.ReactNode;
  last?: boolean;
  testID?: string;
  onPress?: () => void;
}

function RowBody({ title, desc, lead, right, chevron }: RowProps & { chevron: boolean }) {
  const t = useTheme();
  return (
    <>
      {lead != null && <View style={styles.lead}>{lead}</View>}
      <View style={styles.mid}>
        <Text style={[styles.title, { color: t.ink }]}>{title}</Text>
        {!!desc && <Text style={[styles.desc, { color: t.inkSoft }]}>{desc}</Text>}
      </View>
      {right}
      {chevron && <Icon name="chevR" color={t.inkSoft} size={16} strokeWidth={2} />}
    </>
  );
}

/** Tappable row that drills into another screen. */
export function NavRow(p: RowProps) {
  const t = useTheme();
  return (
    <Tap
      testID={p.testID}
      onPress={p.onPress}
      accessibilityRole="button"
      accessibilityLabel={p.title}
      style={[styles.row, { backgroundColor: t.card, borderBottomColor: t.line }, p.last && styles.rowLast]}
    >
      <RowBody {...p} chevron={!p.right} />
    </Tap>
  );
}

/** Row that holds its own control (input, toggle) — the row itself isn't tappable. */
export function ValueRow(p: RowProps) {
  const t = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: t.line }, p.last && styles.rowLast]}>
      <RowBody {...p} chevron={false} />
    </View>
  );
}

/** Row whose content is stacked (label above a picker/keypad/buttons). */
export function StackRow({ title, desc, children, last }: { title: string; desc?: string; children: React.ReactNode; last?: boolean }) {
  const t = useTheme();
  return (
    <View style={[styles.stack, { borderBottomColor: t.line }, last && styles.rowLast]}>
      <Text style={[styles.title, { color: t.ink }]}>{title}</Text>
      {!!desc && <Text style={[styles.desc, { color: t.inkSoft }]}>{desc}</Text>}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { marginTop: 18 },
  groupHead: { fontSize: 11.5, fontWeight: '700', letterSpacing: 1.2, marginBottom: 7, marginLeft: 4 },
  // rows draw their own dividers, so the card only owns the outline + clipping
  card: { borderRadius: RAD.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 13, paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stack: { paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLast: { borderBottomWidth: 0 },
  lead: { width: 24, alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: '600' },
  desc: { fontSize: 11.5, marginTop: 2, lineHeight: 16 },
});
