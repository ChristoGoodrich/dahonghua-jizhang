import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { observer } from '@legendapp/state/react';
import { useTheme } from '@/theme/ThemeContext';
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
  onDeleted?: (restore: () => void) => void;
}

// Read-only view of a single entry — full breakdown (tags, subcategory, account,
// reimbursement, refund…) without dropping the user into the edit form.
export const DetailSheet = observer(function DetailSheet({ entryId, lang, customCats, onClose, onEdit, onDeleted }: Props) {
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
    <View style={styles.overlay}>
      <Pressable style={styles.mask} onPress={onClose} accessibilityRole="button" accessibilityLabel={s.back} />
      <View style={[styles.sheet, { backgroundColor: t.paper }]}>
        <View style={[styles.grip, { backgroundColor: t.line }]} />
        <Text style={[styles.title, { color: t.inkSoft }]}>{s.dtTitle}</Text>

        <View style={styles.hero}>
          <Text style={styles.heroEmoji}>{c.e}</Text>
          <View style={styles.heroMid}>
            <Text style={[styles.heroCat, { color: t.ink }]} numberOfLines={1}>{catName(c, lang)}</Text>
            {!!d.note && <Text style={[styles.heroNote, { color: t.inkSoft }]}>{d.note}</Text>}
          </View>
          <Text style={[styles.heroAmt, { color: amountColor }]}>{sign}{fmt(d.amt, lang)}</Text>
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

        <View style={styles.actions}>
          <Pressable
            style={[styles.actionBtn, { borderColor: t.line, backgroundColor: t.card }]}
            onPress={del}
            accessibilityRole="button"
            accessibilityLabel={s.del}
          >
            <Text style={[styles.actionText, { color: t.hibiscusDeep }]}>🗑  {s.del}</Text>
          </Pressable>
          <Pressable
            style={[styles.actionBtn, { backgroundColor: t.hibiscus }]}
            onPress={() => { onClose(); onEdit(entryId!); }}
            accessibilityRole="button"
            accessibilityLabel={s.markEdit}
          >
            <Text style={[styles.actionText, { color: '#fff' }]}>✏️  {s.markEdit}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 60, elevation: 60 },
  mask: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(43,38,34,0.4)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxWidth: 480, alignSelf: 'center', width: '100%', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 32 },
  grip: { width: 38, height: 4, borderRadius: 4, alignSelf: 'center', marginBottom: 14 },
  title: { fontSize: 12, fontWeight: '600', marginBottom: 10 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  heroEmoji: { fontSize: 30, width: 40, textAlign: 'center' },
  heroMid: { flex: 1, minWidth: 0 },
  heroCat: { fontSize: 17, fontWeight: '700' },
  heroNote: { fontSize: 12.5, marginTop: 2 },
  heroAmt: { fontSize: 20, fontWeight: '800' },
  rows: { maxHeight: 320, marginTop: 8 },
  rowsInner: { paddingBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, paddingVertical: 11, borderBottomWidth: 1 },
  rowLabel: { fontSize: 13, flexShrink: 0 },
  rowValue: { fontSize: 13, fontWeight: '600', flex: 1, textAlign: 'right' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  actionBtn: { flex: 1, borderWidth: 1, borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  actionText: { fontSize: 14, fontWeight: '700' },
});
