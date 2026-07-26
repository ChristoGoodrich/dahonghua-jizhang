import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { observer } from '@legendapp/state/react';
import { store$, setBaseCurrency, setRate, addRate, removeRate, updateRates } from '@/store/ledger';
import { CUR_NAMES, curSymbol } from '@/domain/money';
import { useTheme } from '@/theme/ThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { I18N } from '@/i18n';

const ALL_CODES = Object.keys(CUR_NAMES);

/** Individual rate input — uses key-based remount to refresh after bulk updates. */
function RateInput({ code, initial, onChange }: { code: string; initial: number; onChange: (v: number) => void }) {
  const t = useTheme();
  const [val, setVal] = useState(String(initial));
  return (
    <TextInput
      style={[styles.rateInput, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
      keyboardType="numeric"
      value={val}
      onChangeText={(v) => { setVal(v); onChange(parseFloat(v.replace(/[^\d.]/g, '')) || 0); }}
    />
  );
}

export default observer(function CurrencyScreen() {
  const t = useTheme();
  const lang = store$.lang.get();
  const s = I18N[lang];
  const currencies = store$.currencies.get();
  const base = currencies.base || 'CNY';
  const rates = currencies.rates || {};
  const [status, setStatus] = useState('');
  // Version counter to force re-sync after updateRates
  const [rateVersion, setRateVersion] = useState(0);

  async function doUpdate() {
    setStatus(s.curUpdating);
    const ok = await updateRates();
    setStatus(ok ? s.curUpdated : s.curUpdateFail);
    if (ok) setRateVersion((v) => v + 1);
  }

  // Switching the base re-denominates the whole ledger, so it needs an explicit
  // confirmation and a rate to convert with.
  const [pendingBase, setPendingBase] = useState<string | null>(null);

  function pickBase(code: string) {
    if (code === base) return;
    if (!rates[code]) {
      setStatus(s.curBaseNoRate.replace('%s', code));
      return;
    }
    // Show inline confirmation instead of Alert (Alert doesn't work well on web)
    setPendingBase(code);
    setStatus(s.curBaseConfirm.replace('%s', code));
  }

  function confirmBase() {
    if (!pendingBase) return;
    const result = setBaseCurrency(pendingBase);
    setStatus(result === 'ok' ? s.curBaseDone : s.curBaseNoRate.replace('%s', pendingBase));
    setPendingBase(null);
  }

  function cancelBase() {
    setPendingBase(null);
    setStatus('');
  }

  const addable = ALL_CODES.filter((c) => c !== base && !(c in rates));

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScreenHeader title={s.setCurrency} subtitle={s.setCurrencyD} />
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Text style={[styles.sectionHead, { color: t.inkSoft }]}>{s.curMain}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={styles.chipRow}>
            {ALL_CODES.map((c) => {
              const on = c === base;
              return (
                <Pressable key={c} onPress={() => pickBase(c)} accessibilityRole="button" accessibilityLabel={`${CUR_NAMES[c]} ${c}`} style={[styles.chip, { borderColor: on ? t.hibiscus : t.line, backgroundColor: on ? t.paperWarm : t.card }]}>
                  <Text style={{ fontSize: 12.5, fontWeight: '700', color: on ? t.hibiscus : t.inkSoft }}>{CUR_NAMES[c]}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Inline confirmation for base currency switch */}
          {pendingBase && (
            <View style={styles.confirmRow}>
              <Pressable style={[styles.confirmBtn, { backgroundColor: t.hibiscus }]} onPress={confirmBase} accessibilityRole="button" accessibilityLabel={s.curBaseSwitch}>
                <Text style={styles.confirmText}>{s.curBaseSwitch}</Text>
              </Pressable>
              <Pressable style={[styles.confirmBtn, { borderColor: t.line }]} onPress={cancelBase} accessibilityRole="button" accessibilityLabel={s.cancel}>
                <Text style={[styles.confirmText, { color: t.inkSoft }]}>{s.cancel}</Text>
              </Pressable>
            </View>
          )}

          <Text style={[styles.sectionHead, { color: t.inkSoft }]}>{s.curRate}</Text>
          {Object.keys(rates).map((c) => (
            <View key={c} style={[styles.rateRow, { borderBottomColor: t.line }]}>
              <Text style={[styles.cc, { color: t.ink }]}>{curSymbol(c)}</Text>
              <Text style={[styles.crn, { color: t.inkSoft }]}>{CUR_NAMES[c] || c}</Text>
              <RateInput
                key={`${c}-${rateVersion}`}
                code={c}
                initial={rates[c]}
                onChange={(v) => setRate(c, v)}
              />
              <Pressable onPress={() => removeRate(c)} hitSlop={8} accessibilityRole="button" accessibilityLabel={s.a11yRemoveRate}>
                <Text style={[styles.del, { color: t.inkSoft }]}>✕</Text>
              </Pressable>
            </View>
          ))}

          {addable.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={styles.chipRow}>
              {addable.map((c) => (
                <Pressable key={c} onPress={() => addRate(c)} accessibilityRole="button" accessibilityLabel={`${s.curAddRate.replace('＋ ', '')} ${curSymbol(c)} ${c}`} style={[styles.addChip, { borderColor: t.line, backgroundColor: t.paperWarm }]}>
                  <Text style={{ fontSize: 12.5, fontWeight: '600', color: t.hibiscus }}>＋ {curSymbol(c)} {c}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          <Pressable style={[styles.update, { backgroundColor: t.hibiscus }]} onPress={doUpdate} accessibilityRole="button" accessibilityLabel={s.curUpdate}>
            <Text style={styles.updateText}>{s.curUpdate}</Text>
          </Pressable>
          {!!status && <Text style={[styles.status, { color: t.leafDeep }]}>{status}</Text>}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, maxWidth: 480, width: '100%', alignSelf: 'center' },
  body: { paddingHorizontal: 22, paddingBottom: 60, paddingTop: 6 },
  sectionHead: { fontSize: 12, fontWeight: '600', marginTop: 14, marginBottom: 8 },
  chipRow: { flexGrow: 0 },
  chip: { borderWidth: 1.5, borderRadius: 18, paddingVertical: 8, paddingHorizontal: 13, marginRight: 7 },
  addChip: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 18, paddingVertical: 8, paddingHorizontal: 13, marginRight: 7 },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1 },
  cc: { fontSize: 14, fontWeight: '700', width: 50 },
  crn: { flex: 1, fontSize: 11.5 },
  rateInput: { width: 100, borderWidth: 1, borderRadius: 9, paddingVertical: 7, paddingHorizontal: 9, fontSize: 13, textAlign: 'right' },
  del: { fontSize: 15, paddingHorizontal: 2 },
  update: { borderRadius: 13, padding: 14, alignItems: 'center', marginTop: 18 },
  updateText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  status: { marginTop: 10, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  confirmRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  confirmBtn: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 12, alignItems: 'center' },
  confirmText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
