import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Tap } from '@/components/ui/Tap';
import { Icon, type IconName } from '@/components/ui/Icon';
import { SheetShell } from '@/components/ui/SheetShell';
import { RAD, TABULAR, shadow } from '@/theme/tokens';
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

  const ActionRow = ({ icon, text, onPress }: { icon: IconName; text: string; onPress: () => void }) => (
    <Tap
      style={[styles.btn, { borderColor: t.line, backgroundColor: t.card }, shadow(t, 'xs')]}
      scaleTo={0.97}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={text}
    >
      <View style={[styles.btnIconWrap, { backgroundColor: t.tint }]}>
        <Icon name={icon} color={t.hibiscus} size={17} />
      </View>
      <Text style={[styles.btnText, { color: t.ink }]}>{text}</Text>
      <View style={styles.btnChev}>
        <Icon name="chevR" color={t.line} size={16} strokeWidth={2.2} />
      </View>
    </Tap>
  );

  return (
    <SheetShell onClose={onClose} closeLabel={s.back}>
      <Text style={[styles.title, { color: t.ink }]}>{s.markMenu}</Text>
        <Text style={[styles.summary, TABULAR, { color: t.inkSoft }]}>
          {c.e} {catName(c, lang)} · {fmt(d.amt, lang)}
          {d.refund ? `  ·  ${s.refundDone.replace('%s', fmtShort(d.refund, lang))}` : ''}
        </Text>

        {d.io === 'exp' && (
          <ActionRow icon="receipt" text={isPending ? s.rbUnmark : s.rbMark} onPress={() => { toggleReimburse(entryId!); onClose(); }} />
        )}

        {d.io === 'exp' && !refunding && (
          <ActionRow icon="undo" text={s.markRefund} onPress={() => setRefunding(true)} />
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
            <Tap style={[styles.refundBtn, { backgroundColor: t.hibiscus }]} scaleTo={0.95} onPress={doRefund} accessibilityRole="button" accessibilityLabel={s.markRefund}>
              <Text style={styles.refundBtnText}>{s.markRefund}</Text>
            </Tap>
          </View>
        )}

        <ActionRow icon="edit" text={s.markEdit} onPress={() => { onClose(); onEdit(entryId!); }} />
    </SheetShell>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 15, fontWeight: '700' },
  summary: { fontSize: 12, marginBottom: 14, marginTop: 4 },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: RAD.sm, padding: 11, paddingHorizontal: 13, marginBottom: 9,
  },
  btnIconWrap: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 14, fontWeight: '600', flex: 1 },
  btnChev: { marginLeft: 'auto' },
  refundRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 9 },
  field: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: RAD.xs, padding: 12, fontSize: 14 },
  refundBtn: { borderRadius: RAD.xs, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  refundBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
