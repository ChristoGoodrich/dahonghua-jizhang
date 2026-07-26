import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { observer } from '@legendapp/state/react';
import { store$, addAccount, removeAccount, archiveAccount } from '@/store/ledger';
import { acctBalances } from '@/domain/networth';
import { archivedAccounts } from '@/domain/archive';
import { fmt } from '@/domain/money';
import { useTheme } from '@/theme/ThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EyeToggle } from '@/components/EyeToggle';
import { I18N } from '@/i18n';

export default observer(function AccountsScreen() {
  const t = useTheme();
  const router = useRouter();
  const lang = store$.lang.get();
  const s = I18N[lang];
  const accounts = store$.accounts.get();
  const data = store$.data.get();
  const hide = store$.settings.hideAmounts.get() === true;

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [bal, setBal] = useState('');
  const [kind, setKind] = useState<'cash' | 'credit' | 'prepaid' | 'fx'>('cash');
  const [stmtDay, setStmtDay] = useState('');
  const [dueDay, setDueDay] = useState('');
  const [fxCode, setFxCode] = useState('');

  const clampDay = (v: string) => {
    const n = parseInt(v.replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) ? Math.max(1, Math.min(28, n)) : undefined;
  };

  const kinds: { k: 'cash' | 'credit' | 'prepaid' | 'fx'; label: string }[] = [
    { k: 'cash', label: s.acctKindCash },
    { k: 'credit', label: s.acctKindCredit },
    { k: 'prepaid', label: s.acctKindPrepaid },
    { k: 'fx', label: s.acctKindFx },
  ];
  const acctEmoji = (kd?: string) => (kd === 'credit' ? '💳' : kd === 'prepaid' ? '🎫' : kd === 'fx' ? '💱' : '👛');

  const active = accounts.filter((a) => !a.archived);
  const archived = archivedAccounts(accounts);
  // one ledger pass for the whole list, not one per row
  const balances = acctBalances(accounts, data);

  const AccountRow = ({ a }: { a: (typeof accounts)[number] }) => {
    const isDef = a.id === 'default';
    const bal = balances.get(a.id) ?? 0;
    const owed = a.kind === 'credit' && bal < 0;
    return (
      <View style={[styles.row, { backgroundColor: t.card }, a.archived && styles.rowArchived]}>
        <Pressable style={styles.rowMain} onPress={() => router.push(`/account-detail?id=${a.id}`)}>
          <View style={[styles.emo, { backgroundColor: t.paper }]}>
            <Text style={styles.emoText}>{acctEmoji(a.kind)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, { color: t.ink }]}>
              {lang === 'zh' ? a.name : a.nameEn || a.name}
              {isDef ? ` · ${s.acctDefault}` : a.kind === 'credit' ? ` · ${s.acctKindCredit}` : a.kind === 'fx' ? ` · ${a.fxCode ?? ''}` : ''}
            </Text>
            <Text style={[styles.sub, { color: owed ? t.hibiscus : t.inkSoft }]}>
              {owed ? s.acctOwed : s.acctBalance} {hide ? '****' : fmt(owed ? -bal : bal, lang)}
            </Text>
          </View>
          <Text style={[styles.chev, { color: t.inkSoft }]}>›</Text>
        </Pressable>
        {!isDef && (
          <View style={styles.rowActions}>
            <Pressable
              onPress={() => archiveAccount(a.id, !a.archived)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={a.archived ? s.unarchive : s.archive}
            >
              <Text style={[styles.act, { color: a.archived ? t.hibiscus : t.inkSoft }]}>{a.archived ? '↩' : '📥'}</Text>
            </Pressable>
            {a.archived && (
              <Pressable onPress={() => Alert.alert(s.delConfirmTitle, s.delConfirmMsg, [
                { text: s.cancel, style: 'cancel' },
                { text: s.delConfirmBtn, style: 'destructive', onPress: () => removeAccount(a.id) },
              ])} hitSlop={8} accessibilityRole="button" accessibilityLabel={s.del}>
                <Text style={[styles.del, { color: t.inkSoft }]}>✕</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    );
  };

  function save() {
    if (!name.trim()) return;
    if (kind === 'fx' && !fxCode.trim()) return;
    addAccount(name.trim(), parseFloat(bal.replace(/[^\d.]/g, '')) || 0, kind, {
      statementDay: clampDay(stmtDay),
      dueDay: clampDay(dueDay),
      fxCode: fxCode.trim(),
    });
    setName('');
    setBal('');
    setKind('cash');
    setStmtDay('');
    setDueDay('');
    setFxCode('');
    setAdding(false);
  }

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScreenHeader title={s.setAccounts} subtitle={s.setAccountsD} right={<EyeToggle />} />
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {active.map((a) => (
            <AccountRow key={a.id} a={a} />
          ))}

          {archived.length > 0 && (
            <>
              <Text style={[styles.archHead, { color: t.inkSoft }]}>{s.archivedSection} · {archived.length}</Text>
              <Text style={[styles.archHint, { color: t.inkSoft }]}>{s.archivedHint}</Text>
              {archived.map((a) => (
                <AccountRow key={a.id} a={a} />
              ))}
            </>
          )}

          {adding ? (
            <View style={[styles.form, { borderColor: t.line }]}>
              <View style={[styles.toggle, { backgroundColor: t.line }]}>
                {kinds.map(({ k, label }) => (
                  <Pressable key={k} onPress={() => setKind(k)} accessibilityRole="button" accessibilityState={{ selected: kind === k }} accessibilityLabel={label} style={[styles.toggleBtn, kind === k && { backgroundColor: t.card }]}>
                    <Text style={[styles.toggleText, { color: kind === k ? t.ink : t.inkSoft }]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                style={[styles.field, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
                placeholder={s.acctName}
                placeholderTextColor={t.inkSoft}
                value={name}
                onChangeText={setName}
              />
              <TextInput
                style={[styles.field, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
                placeholder={s.acctBal}
                placeholderTextColor={t.inkSoft}
                keyboardType="numeric"
                value={bal}
                onChangeText={setBal}
              />
              {kind === 'credit' && (
                <View style={styles.dayRow}>
                  <TextInput
                    style={[styles.field, styles.dayField, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
                    placeholder={s.acctStmtDay}
                    placeholderTextColor={t.inkSoft}
                    keyboardType="numeric"
                    value={stmtDay}
                    onChangeText={setStmtDay}
                  />
                  <TextInput
                    style={[styles.field, styles.dayField, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
                    placeholder={s.acctDueDay}
                    placeholderTextColor={t.inkSoft}
                    keyboardType="numeric"
                    value={dueDay}
                    onChangeText={setDueDay}
                  />
                </View>
              )}
              {kind === 'fx' && (
                <>
                  <Text style={[styles.hint, { color: t.inkSoft }]}>{s.acctFxHint}</Text>
                  <TextInput
                    style={[styles.field, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
                    placeholder={s.acctFxCode}
                    placeholderTextColor={t.inkSoft}
                    autoCapitalize="characters"
                    value={fxCode}
                    onChangeText={setFxCode}
                  />
                </>
              )}
              <View style={styles.formActions}>
                <Pressable style={[styles.cancelBtn, { borderColor: t.line }]} onPress={() => { setAdding(false); setName(''); setBal(''); setKind('cash'); setStmtDay(''); setDueDay(''); setFxCode(''); }} accessibilityRole="button" accessibilityLabel={s.cancel}>
                  <Text style={[styles.cancelText, { color: t.inkSoft }]}>{s.cancel}</Text>
                </Pressable>
                <Pressable style={[styles.save, { backgroundColor: t.hibiscus }]} onPress={save} accessibilityRole="button" accessibilityLabel={s.acctSaveBtn}>
                  <Text style={styles.saveText}>{s.acctSaveBtn}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              style={[styles.add, { borderColor: t.line, backgroundColor: t.paperWarm }]}
              onPress={() => setAdding(true)}
              accessibilityRole="button"
              accessibilityLabel={s.acctAdd}
            >
              <Text style={[styles.addText, { color: t.hibiscus }]}>{s.acctAdd}</Text>
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
  rowArchived: { opacity: 0.62 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  act: { fontSize: 16 },
  archHead: { fontSize: 12, fontWeight: '700', marginTop: 14, marginBottom: 2, paddingHorizontal: 2 },
  archHint: { fontSize: 11, marginBottom: 8, paddingHorizontal: 2 },
  chev: { fontSize: 20, fontWeight: '700', paddingHorizontal: 2 },
  emo: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  emoText: { fontSize: 19 },
  name: { fontSize: 14, fontWeight: '650' as any },
  sub: { fontSize: 11.5, marginTop: 2 },
  del: { fontSize: 18, paddingHorizontal: 4 },
  add: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 12, padding: 12, alignItems: 'center', marginTop: 2 },
  addText: { fontSize: 13, fontWeight: '600' },
  form: { borderWidth: 1, borderRadius: 13, padding: 12, marginTop: 2, gap: 10 },
  toggle: { flexDirection: 'row', borderRadius: 11, padding: 3 },
  toggleBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  toggleText: { fontSize: 13, fontWeight: '600' },
  field: { borderWidth: 1, borderRadius: 11, padding: 11, fontSize: 14 },
  hint: { fontSize: 12 },
  dayRow: { flexDirection: 'row', gap: 10 },
  dayField: { flex: 1 },
  formActions: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, borderWidth: 1, borderRadius: 13, padding: 14, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600' },
  save: { flex: 1, borderRadius: 13, padding: 14, alignItems: 'center' },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
