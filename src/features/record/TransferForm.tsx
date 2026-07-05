import React from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Chip } from '@/components/ui/Chip';
import { RAD } from '@/theme/tokens';
import { I18N, type Lang } from '@/i18n';
import type { Account } from '@/domain/types';

interface Props {
  accounts: Account[];
  acct: string; // FROM
  acctTo: string; // TO
  fee: string;
  discount: string;
  setAcct: (id: string) => void;
  setAcctTo: (id: string) => void;
  setFee: (v: string) => void;
  setDiscount: (v: string) => void;
  lang: Lang;
}

const numeric = (v: string) => v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');

/** The transfer (io:'xfer') sub-form: FROM/TO account pickers plus fee/discount. */
export function TransferForm({ accounts, acct, acctTo, fee, discount, setAcct, setAcctTo, setFee, setDiscount, lang }: Props) {
  const t = useTheme();
  const s = I18N[lang];
  const nameOf = (a: Account) => (lang === 'zh' ? a.name : a.nameEn || a.name);

  if (accounts.length < 2) {
    return <Text style={[styles.convLine, { color: t.inkSoft, marginVertical: 16 }]}>{s.xferNeedAccts}</Text>;
  }

  const chip = (a: Account, on: boolean, onPress: () => void) => (
    <Chip key={a.id} label={nameOf(a)} on={on} onPress={onPress} />
  );

  return (
    <View style={styles.xferWrap}>
      <Text style={[styles.pickLabel, { color: t.inkSoft }]}>{s.xferFrom}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.acctRow} keyboardShouldPersistTaps="handled">
        <View style={styles.acctInner}>
          {accounts.map((a) =>
            chip(a, a.id === acct, () => {
              setAcct(a.id);
              if (a.id === acctTo) {
                const o = accounts.find((x) => x.id !== a.id);
                setAcctTo(o ? o.id : '');
              }
            }),
          )}
        </View>
      </ScrollView>

      <Text style={[styles.pickLabel, { color: t.inkSoft }]}>{s.xferTo}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.acctRow} keyboardShouldPersistTaps="handled">
        <View style={styles.acctInner}>
          {accounts.filter((a) => a.id !== acct).map((a) => chip(a, a.id === acctTo, () => setAcctTo(a.id)))}
        </View>
      </ScrollView>

      <View style={styles.xferFeeRow}>
        <View style={styles.xferFeeCol}>
          <Text style={[styles.pickLabel, { color: t.inkSoft }]}>{s.xferFee}</Text>
          <TextInput
            style={[styles.field, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
            value={fee}
            onChangeText={(v) => setFee(numeric(v))}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={t.inkSoft}
          />
        </View>
        <View style={styles.xferFeeCol}>
          <Text style={[styles.pickLabel, { color: t.inkSoft }]}>{s.xferDiscount}</Text>
          <TextInput
            style={[styles.field, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
            value={discount}
            onChangeText={(v) => setDiscount(numeric(v))}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={t.inkSoft}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  xferWrap: { marginBottom: 12, gap: 6 },
  acctRow: { marginBottom: 12 },
  acctInner: { flexDirection: 'row', gap: 7, paddingVertical: 2 },
  pickLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 6 },
  field: { borderWidth: StyleSheet.hairlineWidth, borderRadius: RAD.xs, padding: 11, fontSize: 14, fontVariant: ['tabular-nums'] },
  xferFeeRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  xferFeeCol: { flex: 1, gap: 5 },
  convLine: { fontSize: 11, fontWeight: '600', textAlign: 'center', marginBottom: 10 },
});
