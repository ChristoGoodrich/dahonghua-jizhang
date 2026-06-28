import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { observer } from '@legendapp/state/react';
import { store$, addSub, removeSub } from '@/store/ledger';
import { nextDueDate } from '@/domain/subscriptions';
import { allCats, catOf } from '@/domain/cats';
import { fmtShort } from '@/domain/money';
import { useTheme } from '@/theme/ThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { I18N } from '@/i18n';

export default observer(function SubsScreen() {
  const t = useTheme();
  const lang = store$.lang.get();
  const s = I18N[lang];
  const subs = store$.subs.get();
  const customCats = store$.customCats.get();
  const accounts = store$.accounts.get();
  const canTransfer = accounts.length >= 2;

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [amt, setAmt] = useState('');
  const [freq, setFreq] = useState<'monthly' | 'yearly'>('monthly');
  const [day, setDay] = useState('1');
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [cat, setCat] = useState('home');
  const [kind, setKind] = useState<'expense' | 'transfer'>('expense');
  const [from, setFrom] = useState(accounts[0]?.id ?? 'default');
  const [to, setTo] = useState(accounts.find((a) => a.id !== (accounts[0]?.id ?? 'default'))?.id ?? '');
  const [periods, setPeriods] = useState('');

  const acctName = (a: { name: string; nameEn?: string }) => (lang === 'zh' ? a.name : a.nameEn || a.name);
  const nameById = (id?: string) => { const a = accounts.find((x) => x.id === id); return a ? acctName(a) : '?'; };

  function save() {
    if (!name.trim()) return;
    const a = parseFloat(amt.replace(/[^\d.]/g, '')) || 0;
    if (a <= 0) return;
    const base = {
      name: name.trim(),
      amt: a,
      freq,
      day: Math.max(1, Math.min(28, parseInt(day, 10) || 1)),
      month: Math.max(1, Math.min(12, parseInt(month, 10) || 1)),
    };
    if (kind === 'transfer') {
      if (!from || !to || from === to) return;
      addSub({ ...base, emoji: '🔄', cat: 'transfer', kind: 'transfer', from, to });
    } else {
      const c = catOf('exp', cat, customCats);
      const n = parseInt(periods, 10);
      addSub({ ...base, emoji: c.e || '🔁', cat, ...(n > 0 ? { periods: Math.min(n, 360) } : {}) });
    }
    setName('');
    setAmt('');
    setPeriods('');
    setAdding(false);
  }

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScreenHeader title={s.setSubs} subtitle={s.setSubsD} />
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {subs.map((sub) => {
            const due = nextDueDate(sub, new Date());
            const isToday = due.toDateString() === new Date().toDateString();
            const dueLab = isToday
              ? s.subDueToday
              : s.subNext.replace('%s', due.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' }));
            const freqLab = sub.freq === 'yearly' ? s.subYearly : s.subMonthly;
            const done = !!sub.periods && (sub.charged ?? 0) >= sub.periods;
            return (
              <View key={sub.id} style={[styles.row, { backgroundColor: t.card }]}>
                <View style={[styles.emo, { backgroundColor: t.paper }]}>
                  <Text style={styles.emoText}>{sub.emoji || '🔁'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: t.ink }]}>{sub.name}</Text>
                  <Text style={[styles.sub, { color: done ? t.leafDeep : isToday ? t.hibiscus : t.inkSoft }]} numberOfLines={1}>
                    {sub.kind === 'transfer' && sub.from && sub.to ? `${nameById(sub.from)} → ${nameById(sub.to)} · ` : ''}
                    {sub.periods ? s.subInstallment.replace('%s', String(sub.charged ?? 0)).replace('%s', String(sub.periods)) + ' · ' : ''}
                    {done ? s.subDone : `${freqLab} · ${dueLab}`}
                  </Text>
                </View>
                <Text style={[styles.amt, { color: t.ink }]}>{fmtShort(sub.amt, lang)}</Text>
                <Pressable onPress={() => removeSub(sub.id)} hitSlop={10}>
                  <Text style={[styles.del, { color: t.inkSoft }]}>✕</Text>
                </Pressable>
              </View>
            );
          })}

          {adding ? (
            <View style={[styles.form, { borderColor: t.line }]}>
              {canTransfer && (
                <>
                  <Text style={[styles.label, { color: t.inkSoft }]}>{s.subKind}</Text>
                  <View style={[styles.toggle, { backgroundColor: t.line }]}>
                    {(['expense', 'transfer'] as const).map((k) => (
                      <Pressable key={k} onPress={() => setKind(k)} style={[styles.toggleBtn, kind === k && { backgroundColor: t.card }]}>
                        <Text style={[styles.toggleText, { color: kind === k ? t.ink : t.inkSoft }]}>{k === 'expense' ? s.subExpense : s.subTransfer}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
              <TextInput style={[styles.field, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]} placeholder={s.subName} placeholderTextColor={t.inkSoft} value={name} onChangeText={setName} />
              <Text style={[styles.label, { color: t.inkSoft }]}>{s.subAmtL}</Text>
              <TextInput style={[styles.field, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]} placeholder="0" placeholderTextColor={t.inkSoft} keyboardType="numeric" value={amt} onChangeText={setAmt} />
              <Text style={[styles.label, { color: t.inkSoft }]}>{s.subFreqL}</Text>
              <View style={[styles.toggle, { backgroundColor: t.line }]}>
                {(['monthly', 'yearly'] as const).map((k) => (
                  <Pressable key={k} onPress={() => setFreq(k)} style={[styles.toggleBtn, freq === k && { backgroundColor: t.card }]}>
                    <Text style={[styles.toggleText, { color: freq === k ? t.ink : t.inkSoft }]}>{k === 'monthly' ? s.subMonthly : s.subYearly}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.dayMonthRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: t.inkSoft }]}>{s.subDayL}</Text>
                  <TextInput style={[styles.field, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]} keyboardType="numeric" value={day} onChangeText={setDay} />
                </View>
                {freq === 'yearly' && (
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.label, { color: t.inkSoft }]}>{s.subMonthL}</Text>
                    <TextInput style={[styles.field, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]} keyboardType="numeric" value={month} onChangeText={setMonth} />
                  </View>
                )}
              </View>
              {kind === 'transfer' ? (
                <>
                  <Text style={[styles.label, { color: t.inkSoft }]}>{s.xferFrom}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                    {accounts.map((a) => {
                      const on = a.id === from;
                      return (
                        <Pressable
                          key={a.id}
                          onPress={() => {
                            setFrom(a.id);
                            if (a.id === to) { const o = accounts.find((x) => x.id !== a.id); setTo(o ? o.id : ''); }
                          }}
                          style={[styles.catChip, { borderColor: on ? t.hibiscus : t.line, backgroundColor: on ? t.paperWarm : t.card }]}
                        >
                          <Text style={{ fontSize: 12.5, color: on ? t.hibiscus : t.inkSoft }}>{acctName(a)}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  <Text style={[styles.label, { color: t.inkSoft }]}>{s.xferTo}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                    {accounts.filter((a) => a.id !== from).map((a) => {
                      const on = a.id === to;
                      return (
                        <Pressable key={a.id} onPress={() => setTo(a.id)} style={[styles.catChip, { borderColor: on ? t.hibiscus : t.line, backgroundColor: on ? t.paperWarm : t.card }]}>
                          <Text style={{ fontSize: 12.5, color: on ? t.hibiscus : t.inkSoft }}>{acctName(a)}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </>
              ) : (
                <>
                  <Text style={[styles.label, { color: t.inkSoft }]}>{s.subCatL}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                    {allCats('exp', customCats).map((c) => {
                      const on = c.k === cat;
                      return (
                        <Pressable key={c.k} onPress={() => setCat(c.k)} style={[styles.catChip, { borderColor: on ? t.hibiscus : t.line, backgroundColor: on ? t.paperWarm : t.card }]}>
                          <Text style={{ fontSize: 12.5, color: on ? t.hibiscus : t.inkSoft }}>{c.e} {lang === 'zh' ? c.zh : c.en}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  <Text style={[styles.label, { color: t.inkSoft }]}>{s.subPeriods}</Text>
                  <TextInput
                    style={[styles.field, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
                    keyboardType="numeric"
                    placeholder="12"
                    placeholderTextColor={t.inkSoft}
                    value={periods}
                    onChangeText={(v) => setPeriods(v.replace(/[^\d]/g, ''))}
                  />
                </>
              )}
              <Pressable style={[styles.save, { backgroundColor: t.hibiscus }]} onPress={save}>
                <Text style={styles.saveText}>{s.subSaveBtn}</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable style={[styles.add, { borderColor: t.line, backgroundColor: t.paperWarm }]} onPress={() => setAdding(true)}>
              <Text style={[styles.addText, { color: t.hibiscus }]}>{s.subAdd}</Text>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 13, padding: 12, marginBottom: 8 },
  emo: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  emoText: { fontSize: 19 },
  name: { fontSize: 14, fontWeight: '650' as any },
  sub: { fontSize: 11, marginTop: 1 },
  amt: { fontWeight: '700', fontSize: 14 },
  del: { fontSize: 17, paddingHorizontal: 2, marginLeft: 4 },
  add: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 12, padding: 12, alignItems: 'center', marginTop: 2 },
  addText: { fontSize: 13, fontWeight: '600' },
  form: { borderWidth: 1, borderRadius: 13, padding: 12, marginTop: 2, gap: 8 },
  label: { fontSize: 12, fontWeight: '600', marginTop: 4 },
  field: { borderWidth: 1, borderRadius: 11, padding: 11, fontSize: 14 },
  toggle: { flexDirection: 'row', borderRadius: 11, padding: 3 },
  toggleBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  toggleText: { fontSize: 13, fontWeight: '600' },
  dayMonthRow: { flexDirection: 'row', gap: 10 },
  catChip: { borderWidth: 1.5, borderRadius: 18, paddingVertical: 7, paddingHorizontal: 12, marginRight: 7 },
  save: { borderRadius: 13, padding: 14, alignItems: 'center', marginTop: 6 },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
