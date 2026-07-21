import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { observer } from '@legendapp/state/react';
import { useTheme } from '@/theme/ThemeContext';
import { Tap } from '@/components/ui/Tap';
import { Icon } from '@/components/ui/Icon';
import { GradientFill } from '@/components/ui/GradientFill';
import { SheetShell } from '@/components/ui/SheetShell';
import { RAD, TABULAR, shadow } from '@/theme/tokens';
import { catOf, catName } from '@/domain/cats';
import { fmt, fmtShort } from '@/domain/money';
import { store$, removeEntry } from '@/store/ledger';
import type { Category, IO } from '@/domain/types';
import { I18N, type Lang } from '@/i18n';

interface Props {
  entryId: string | null;
  lang: Lang;
  customCats: Record<IO, Category[]>;
  onClose: () => void;
  onEdit: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onDeleted?: (restore: () => void) => void;
}

// Read-only view of a single entry — full breakdown (tags, subcategory, account,
// reimbursement, refund…) without dropping the user into the edit form.
export const DetailSheet = observer(function DetailSheet({ entryId, lang, customCats, onClose, onEdit, onDuplicate, onDeleted }: Props) {
  const t = useTheme();
  const s = I18N[lang];
  const loc = lang === 'zh' ? 'zh-CN' : 'en-US';

  if (!entryId) return null;
  const d = store$.data.get().find((x) => x.id === entryId);
  if (!d) return null;

  const c = catOf(d.io, d.cat, customCats);
  const accountName = (id?: string) => {
    if (!id) return '';
    const a = store$.accounts.peek().find((x) => x.id === id);
    return a ? (lang === 'zh' ? a.name : a.nameEn || a.name) : id;
  };
  const subcatName = (() => {
    if (!d.subcat) return '';
    const list = store$.subcats.peek()[d.cat] ?? [];
    return list.find((x) => x.k === d.subcat)?.name ?? d.subcat;
  })();

  const typeLabel = d.io === 'exp' ? s.exp : d.io === 'inc' ? s.inc : s.xfer;
  const sign = d.io === 'inc' ? '+' : d.io === 'exp' ? '-' : '';
  const amountColor = d.io === 'inc' ? t.leafDeep : d.io === 'exp' ? t.hibiscusDeep : t.ink;
  const dateText = new Date(d.ts).toLocaleString(loc, {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit',
  });

  function del() {
    const prev = store$.data.peek();
    removeEntry(entryId!);
    onDeleted?.(() => store$.data.set(prev));
    onClose();
  }

  const Row = ({ label, value }: { label: string; value: string }) =>
    value ? (
      <View style={[styles.row, { borderBottomColor: t.line }]}>
        <Text style={[styles.rowLabel, { color: t.inkSoft }]}>{label}</Text>
        <Text style={[styles.rowValue, { color: t.ink }]}>{value}</Text>
      </View>
    ) : null;

  return (
    <SheetShell onClose={onClose} closeLabel={s.back}>
      <Text style={[styles.title, { color: t.inkSoft }]}>{s.dtTitle}</Text>

        <View style={styles.hero}>
          <View style={[styles.heroEmoWrap, { backgroundColor: c.c + (t.isDark ? '30' : '1F') }]}>
            <Text style={styles.heroEmoji}>{c.e}</Text>
          </View>
          <View style={styles.heroMid}>
            <Text style={[styles.heroCat, { color: t.ink }]} numberOfLines={1}>{catName(c, lang)}</Text>
            {!!d.note && <Text style={[styles.heroNote, { color: t.inkSoft }]}>{d.note}</Text>}
          </View>
          <Text style={[styles.heroAmt, TABULAR, { color: amountColor }]}>{sign}{fmt(d.amt, lang)}</Text>
        </View>

        <ScrollView style={styles.rows} contentContainerStyle={styles.rowsInner} showsVerticalScrollIndicator={false}>
          <Row label={s.dtType} value={typeLabel} />
          <Row label={s.dtTime} value={dateText} />
          {d.io === 'xfer' ? (
            <Row label={s.dtAccount} value={`${accountName(d.acct)} → ${accountName(d.acctTo)}`} />
          ) : (
            <Row label={s.dtAccount} value={accountName(d.acct)} />
          )}
          <Row label={s.dtSubcat} value={subcatName} />
          {d.cur && d.origAmt != null && <Row label={s.dtOrig} value={`${d.origAmt} ${d.cur}`} />}
          <Row label={s.tagPick} value={(d.tags ?? []).map((x) => `#${x}`).join('  ')} />
          <Row label={s.ledgerPick} value={d.ledger ?? ''} />
          <Row label={s.dtReimburse} value={d.rb === 'pending' ? s.rbPending : d.rb === 'done' ? s.rbDone : ''} />
          <Row label={s.dtRefund} value={d.refund ? fmtShort(d.refund, lang) : ''} />
          <Row label={s.dtFromSub} value={d.fromSub ? '✓' : ''} />
        </ScrollView>

        <View style={styles.actionsCol}>
          {/* 再记一笔 is the primary action — opening a past entry is most often a
              prelude to logging another like it (a daily coffee, the commute) */}
          {onDuplicate && (
            <Tap
              style={[styles.actionBtn, styles.actionPrimary, { backgroundColor: t.hibiscus }, shadow(t, 'glow')]}
              scaleTo={0.97}
              onPress={() => { onClose(); onDuplicate(entryId!); }}
              accessibilityRole="button"
              accessibilityLabel={s.dtDupe}
            >
              <GradientFill from={t.gradFrom} to={t.gradTo} />
              <Icon name="plus" color="#fff" size={17} strokeWidth={2.5} />
              <Text style={[styles.actionText, { color: '#fff' }]}>{s.dtDupe}</Text>
            </Tap>
          )}
          <View style={styles.actions}>
            <Tap
              style={[styles.actionBtn, { borderColor: t.line, backgroundColor: t.card }]}
              scaleTo={0.97}
              onPress={del}
              accessibilityRole="button"
              accessibilityLabel={s.del}
            >
              <Icon name="trash" color={t.hibiscusDeep} size={17} />
              <Text style={[styles.actionText, { color: t.hibiscusDeep }]}>{s.del}</Text>
            </Tap>
            <Tap
              style={[styles.actionBtn, { borderColor: t.line, backgroundColor: t.card }]}
              scaleTo={0.97}
              onPress={() => { onClose(); onEdit(entryId!); }}
              accessibilityRole="button"
              accessibilityLabel={s.markEdit}
            >
              <Icon name="edit" color={t.ink} size={17} />
              <Text style={[styles.actionText, { color: t.ink }]}>{s.markEdit}</Text>
            </Tap>
          </View>
        </View>
    </SheetShell>
  );
});

const styles = StyleSheet.create({
  title: { fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 10 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  heroEmoWrap: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  heroEmoji: { fontSize: 24 },
  heroMid: { flex: 1, minWidth: 0 },
  heroCat: { fontSize: 17, fontWeight: '700' },
  heroNote: { fontSize: 12.5, marginTop: 2 },
  heroAmt: { fontSize: 21, fontWeight: '800', letterSpacing: -0.4 },
  rows: { maxHeight: 320, marginTop: 8 },
  rowsInner: { paddingBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLabel: { fontSize: 13, flexShrink: 0 },
  rowValue: { fontSize: 13, fontWeight: '600', flex: 1, textAlign: 'right' },
  actionsCol: { gap: 10, marginTop: 18 },
  actions: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1, borderWidth: 1, borderRadius: RAD.sm, paddingVertical: 13,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7,
  },
  actionPrimary: { borderWidth: 0, overflow: 'hidden' },
  actionText: { fontSize: 14, fontWeight: '700' },
});
