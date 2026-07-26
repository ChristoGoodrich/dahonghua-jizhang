import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { observer } from '@legendapp/state/react';
import { store$, addLoan, repayLoan, removeLoan } from '@/store/ledger';
import { loanRemaining } from '@/domain/networth';
import { fmt, fmtShort } from '@/domain/money';
import { useTheme } from '@/theme/ThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { I18N } from '@/i18n';

export default observer(function LoansScreen() {
  const t = useTheme();
  const lang = store$.lang.get();
  const s = I18N[lang];
  const loans = store$.loans.get();

  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<'lend' | 'borrow'>('lend');
  const [who, setWho] = useState('');
  const [amt, setAmt] = useState('');
  const [repayId, setRepayId] = useState<string | null>(null);
  const [repayAmt, setRepayAmt] = useState('');

  let owedMe = 0;
  let iOwe = 0;
  for (const l of loans) {
    const rem = loanRemaining(l);
    if (l.type === 'lend') owedMe += rem;
    else iOwe += rem;
  }

  function saveLoan() {
    if (!who.trim()) return;
    const v = parseFloat(amt.replace(/[^\d.]/g, '')) || 0;
    if (v <= 0) return;
    addLoan(who.trim(), type, v);
    setWho('');
    setAmt('');
    setAdding(false);
  }

  function confirmRepay(id: string) {
    const v = parseFloat(repayAmt.replace(/[^\d.]/g, '')) || 0;
    if (v > 0) repayLoan(id, v);
    setRepayId(null);
    setRepayAmt('');
  }

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScreenHeader title={s.setLoans} subtitle={s.setLoansD} />
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={styles.summ}>
            <View style={[styles.s2, { backgroundColor: t.card }]}>
              <Text style={[styles.s2l, { color: t.inkSoft }]}>{s.loanOwedMe}</Text>
              <Text style={[styles.s2v, { color: t.leafDeep }]}>{fmt(owedMe, lang)}</Text>
            </View>
            <View style={[styles.s2, { backgroundColor: t.card }]}>
              <Text style={[styles.s2l, { color: t.inkSoft }]}>{s.loanIOwe}</Text>
              <Text style={[styles.s2v, { color: t.hibiscus }]}>{fmt(iOwe, lang)}</Text>
            </View>
          </View>

          {loans.map((l) => {
            const rem = loanRemaining(l);
            const pct = l.amt ? Math.min(((l.repaid ?? 0) / l.amt) * 100, 100) : 0;
            const done = rem <= 0;
            return (
              <View key={l.id} style={[styles.loanRow, { backgroundColor: t.card }]}>
                <Pressable onPress={() => { setRepayId(repayId === l.id ? null : l.id); setRepayAmt(''); }}>
                  <View style={styles.loanHead}>
                    <View style={[styles.emo, { backgroundColor: t.paper }]}>
                      <Text style={styles.emoText}>{l.type === 'lend' ? '💸' : '🪙'}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.name, { color: t.ink }]}>{l.who}</Text>
                      <Text style={[styles.sub, { color: t.inkSoft }]}>{l.type === 'lend' ? s.loanLend : s.loanBorrow}</Text>
                    </View>
                    <Text style={[styles.amt, { color: l.type === 'lend' ? t.leafDeep : t.hibiscus }]}>{fmt(l.amt, lang)}</Text>
                  </View>
                  <View style={[styles.track, { backgroundColor: t.line }]}>
                    <View style={[styles.fill, { width: `${pct}%`, backgroundColor: done ? t.leaf : l.type === 'lend' ? t.leaf : t.hibiscus }]} />
                  </View>
                  <View style={styles.loanSub}>
                    <Text style={[styles.subSmall, { color: t.inkSoft }]}>{s.loanProgress} {Math.round(pct)}%</Text>
                    <Text style={[styles.subSmall, { color: t.inkSoft }]}>
                      {done ? s.loanCleared : s.loanRemain.replace('%s', fmtShort(rem, lang))}
                    </Text>
                  </View>
                </Pressable>

                {repayId === l.id && !done && (
                  <View style={styles.repayRow}>
                    <TextInput
                      style={[styles.field, { flex: 1, borderColor: t.line, color: t.ink, backgroundColor: t.paper }]}
                      placeholder={s.repayAmt}
                      placeholderTextColor={t.inkSoft}
                      keyboardType="numeric"
                      value={repayAmt}
                      onChangeText={setRepayAmt}
                    />
                    <Pressable style={[styles.repayBtn, { backgroundColor: t.leaf }]} onPress={() => confirmRepay(l.id)}>
                      <Text style={styles.repayBtnText}>{s.loanRepay}</Text>
                    </Pressable>
                  </View>
                )}
                {repayId === l.id && done && (
                  <Pressable style={styles.repayRow} onPress={() => removeLoan(l.id)}>
                    <Text style={[styles.subSmall, { color: t.hibiscus }]}>✕ {s.del}</Text>
                  </Pressable>
                )}
              </View>
            );
          })}

          {adding ? (
            <View style={[styles.form, { borderColor: t.line }]}>
              <View style={[styles.toggle, { backgroundColor: t.line }]}>
                {(['lend', 'borrow'] as const).map((k) => (
                  <Pressable key={k} onPress={() => setType(k)} style={[styles.toggleBtn, type === k && { backgroundColor: t.card }]}>
                    <Text style={[styles.toggleText, { color: type === k ? t.ink : t.inkSoft }]}>{k === 'lend' ? s.loanLend : s.loanBorrow}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput style={[styles.field, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]} placeholder={s.loanWho} placeholderTextColor={t.inkSoft} value={who} onChangeText={setWho} />
              <TextInput style={[styles.field, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]} placeholder={s.loanAmt} placeholderTextColor={t.inkSoft} keyboardType="numeric" value={amt} onChangeText={setAmt} />
              <Pressable style={[styles.save, { backgroundColor: t.hibiscus }]} onPress={saveLoan}>
                <Text style={styles.saveText}>{s.loanSave}</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable style={[styles.add, { borderColor: t.line, backgroundColor: t.paperWarm }]} onPress={() => setAdding(true)}>
              <Text style={[styles.addText, { color: t.hibiscus }]}>{s.loanAdd}</Text>
            </Pressable>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, maxWidth: 480, width: '100%', alignSelf: 'center' },
  body: { paddingHorizontal: 22, paddingBottom: 60, paddingTop: 6 },
  summ: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  s2: { flex: 1, borderRadius: 13, padding: 12 },
  s2l: { fontSize: 11 },
  s2v: { fontSize: 19, fontWeight: '700', marginTop: 2 },
  loanRow: { borderRadius: 13, padding: 12, marginBottom: 9 },
  loanHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  emo: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  emoText: { fontSize: 17 },
  name: { fontSize: 14, fontWeight: '600' },
  sub: { fontSize: 11, marginTop: 1 },
  amt: { fontWeight: '700' },
  track: { height: 6, borderRadius: 6, overflow: 'hidden', marginVertical: 9 },
  fill: { height: '100%', borderRadius: 6 },
  loanSub: { flexDirection: 'row', justifyContent: 'space-between' },
  subSmall: { fontSize: 10.5 },
  repayRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  repayBtn: { borderRadius: 11, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
  repayBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  add: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 12, padding: 12, alignItems: 'center', marginTop: 2 },
  addText: { fontSize: 13, fontWeight: '600' },
  form: { borderWidth: 1, borderRadius: 13, padding: 12, marginTop: 2, gap: 10 },
  toggle: { flexDirection: 'row', borderRadius: 11, padding: 3 },
  toggleBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  toggleText: { fontSize: 13, fontWeight: '600' },
  field: { borderWidth: 1, borderRadius: 11, padding: 11, fontSize: 14 },
  save: { borderRadius: 13, padding: 14, alignItems: 'center' },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
