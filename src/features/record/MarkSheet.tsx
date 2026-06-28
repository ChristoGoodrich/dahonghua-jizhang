import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { catOf, catName } from '@/domain/cats';
import { fmt, fmtShort } from '@/domain/money';
import type { Category, IO } from '@/domain/types';
import type { Lang } from '@/i18n';
import { I18N } from '@/i18n';
import { store$, toggleReimburse, refundEntry } from '@/store/ledger';

interface Props {
  entryId: string | null;
  lang: Lang;
  customCats: Record<IO, Category[]>;
  onClose: () => void;
  onEdit: (id: string) => void;
}

export function MarkSheet({ entryId, lang, customCats, onClose, onEdit }: Props) {
  const t = useTheme();
  const s = I18N[lang];
  const [refunding, setRefunding] = useState(false);
  const [refundAmt, setRefundAmt] = useState('');

  useEffect(() => {
    setRefunding(false);
    setRefundAmt('');
  }, [entryId]);

  if (!entryId) return null;
  const d = store$.data.peek().find((x) => x.id === entryId);
  if (!d) return null;
  const c = catOf(d.io, d.cat, customCats);
  const isPending = d.rb === 'pending';

  function doRefund() {
    const v = parseFloat(refundAmt.replace(/[^\d.]/g, '')) || 0;
    if (v > 0) refundEntry(entryId!, v, lang);
    onClose();
  }

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.mask} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: t.paper }]}>
        <View style={[styles.grip, { backgroundColor: t.line }]} />
        <Text style={[styles.title, { color: t.ink }]}>{s.markMenu}</Text>
        <Text style={[styles.summary, { color: t.inkSoft }]}>
          {c.e} {catName(c, lang)} · {fmt(d.amt, lang)}
          {d.refund ? `  ·  ${s.refundDone.replace('%s', fmtShort(d.refund, lang))}` : ''}
        </Text>

        {d.io === 'exp' && (
          <Pressable style={[styles.btn, { borderColor: t.line, backgroundColor: t.card }]} onPress={() => { toggleReimburse(entryId!); onClose(); }}>
            <Text style={styles.btnIcon}>🧾</Text>
            <Text style={[styles.btnText, { color: t.ink }]}>{isPending ? s.rbUnmark : s.rbMark}</Text>
          </Pressable>
        )}

        {d.io === 'exp' && !refunding && (
          <Pressable style={[styles.btn, { borderColor: t.line, backgroundColor: t.card }]} onPress={() => setRefunding(true)}>
            <Text style={styles.btnIcon}>↩️</Text>
            <Text style={[styles.btnText, { color: t.ink }]}>{s.markRefund}</Text>
          </Pressable>
        )}

        {refunding && (
          <View style={styles.refundRow}>
            <TextInput
              style={[styles.field, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
              placeholder={s.refundAmt}
              placeholderTextColor={t.inkSoft}
              keyboardType="numeric"
              value={refundAmt}
              onChangeText={setRefundAmt}
              autoFocus
            />
            <Pressable style={[styles.refundBtn, { backgroundColor: t.hibiscus }]} onPress={doRefund}>
              <Text style={styles.refundBtnText}>{s.markRefund}</Text>
            </Pressable>
          </View>
        )}

        <Pressable style={[styles.btn, { borderColor: t.line, backgroundColor: t.card }]} onPress={() => { onClose(); onEdit(entryId!); }}>
          <Text style={styles.btnIcon}>✏️</Text>
          <Text style={[styles.btnText, { color: t.ink }]}>{s.markEdit}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 60, elevation: 60 },
  mask: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(43,38,34,0.4)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxWidth: 480, alignSelf: 'center', width: '100%', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 32 },
  grip: { width: 38, height: 4, borderRadius: 4, alignSelf: 'center', marginBottom: 16 },
  title: { fontSize: 15, fontWeight: '750' as any },
  summary: { fontSize: 12, marginBottom: 14, marginTop: 4 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 13, padding: 14, marginBottom: 9 },
  btnIcon: { fontSize: 19 },
  btnText: { fontSize: 14, fontWeight: '600' },
  refundRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 9 },
  field: { flex: 1, borderWidth: 1, borderRadius: 11, padding: 12, fontSize: 14 },
  refundBtn: { borderRadius: 11, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  refundBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
