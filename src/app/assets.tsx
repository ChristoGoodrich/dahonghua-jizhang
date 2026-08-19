import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { observer } from '@legendapp/state/react';
import { store$, addAsset, removeAsset } from '@/store/ledger';
import { acctBalances, netWorthParts } from '@/domain/networth';
import { fmt } from '@/domain/money';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from '@/components/Flower';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EyeToggle } from '@/components/EyeToggle';
import { I18N } from '@/i18n';

export default observer(function AssetsScreen() {
  const t = useTheme();
  const lang = store$.lang.get();
  const s = I18N[lang];
  const accounts = store$.accounts.get();
  const data = store$.data.get();
  const assets = store$.assets.get();
  const loans = store$.loans.get();
  const p = netWorthParts(accounts, data, assets, loans);
  // one ledger pass for the account list below, not one per row
  const balances = acctBalances(accounts, data);
  const hide = store$.settings.hideAmounts.get() === true;
  const m = (v: number) => (hide ? '****' : fmt(v, lang));

  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<'asset' | 'liab'>('asset');
  const [name, setName] = useState('');
  const [val, setVal] = useState('');

  function save() {
    if (!name.trim()) return;
    const v = parseFloat(val.replace(/[^\d.]/g, '')) || 0;
    if (v <= 0) return;
    addAsset(name.trim(), type, v);
    setName('');
    setVal('');
    setAdding(false);
  }

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScreenHeader title={s.setAssets} subtitle={s.setAssetsD} right={<EyeToggle />} />
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={[styles.card, { backgroundColor: t.ink }]}>
            <View style={styles.bgFlower}>
              <Flower size={90} petal="#ffffff" stamen="#ffffff" />
            </View>
            <Text style={[styles.nwLabel, { color: t.paper }]}>{s.assetNet}</Text>
            <Text style={[styles.nwVal, { color: t.paper }]}>{m(p.net)}</Text>
            <View style={styles.nwIo}>
              <View>
                <Text style={[styles.nwK, { color: t.paper }]}>{s.assetTotal}</Text>
                <Text style={[styles.nwV, { color: '#9DC4B3' }]}>{m(p.asset)}</Text>
              </View>
              <View>
                <Text style={[styles.nwK, { color: t.paper }]}>{s.assetDebt}</Text>
                <Text style={[styles.nwV, { color: t.hibiscusSoft }]}>{m(p.liab)}</Text>
              </View>
            </View>
          </View>

          <Text style={[styles.sectionHead, { color: t.inkSoft }]}>{s.setAccounts}</Text>
          {accounts.map((a) => {
            const bal = balances.get(a.id) ?? 0;
            const debt = a.kind === 'credit' && bal < 0;
            return (
              <View key={a.id} style={[styles.row, { backgroundColor: t.card }]}>
                <View style={[styles.emo, { backgroundColor: t.paper }]}>
                  <Text style={styles.emoText}>{a.kind === 'credit' ? '💳' : a.kind === 'prepaid' ? '🎫' : '👛'}</Text>
                </View>
                <Text style={[styles.name, { color: t.ink, flex: 1 }]}>{lang === 'zh' ? a.name : a.nameEn || a.name}</Text>
                <Text style={[styles.amt, { color: debt ? t.hibiscus : t.ink }]}>{m(bal)}</Text>
              </View>
            );
          })}

          {assets.length > 0 && (
            <Text style={[styles.sectionHead, { color: t.inkSoft }]}>{s.assetTotal} / {s.assetDebt}</Text>
          )}
          {assets.map((a) => (
            <View key={a.id} style={[styles.row, { backgroundColor: t.card }]}>
              <View style={[styles.emo, { backgroundColor: t.paper }]}>
                <Text style={styles.emoText}>{a.type === 'liab' ? '💳' : '🏦'}</Text>
              </View>
              <Text style={[styles.name, { color: t.ink, flex: 1 }]}>{a.name}</Text>
              <Text style={[styles.amt, { color: a.type === 'liab' ? t.hibiscus : t.leafDeep }]}>
                {a.type === 'liab' && !hide ? '-' : ''}
                {m(a.val)}
              </Text>
              <Pressable
                onPress={() => removeAsset(a.id)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={s.a11yAssetDelete.replace('%s', a.name)}
              >
                <Text style={[styles.del, { color: t.inkSoft }]}>✕</Text>
              </Pressable>
            </View>
          ))}

          {adding ? (
            <View style={[styles.form, { borderColor: t.line }]}>
              <View style={[styles.toggle, { backgroundColor: t.line }]}>
                {(['asset', 'liab'] as const).map((k) => (
                  <Pressable
                    key={k}
                    onPress={() => setType(k)}
                    style={[styles.toggleBtn, type === k && { backgroundColor: t.card }]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: type === k }}
                    accessibilityLabel={s.a11yAssetType.replace('%s', k === 'asset' ? s.assetAsset : s.assetLiab)}
                  >
                    <Text style={[styles.toggleText, { color: type === k ? t.ink : t.inkSoft }]}>
                      {k === 'asset' ? s.assetAsset : s.assetLiab}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput style={[styles.field, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]} placeholder={s.assetName} placeholderTextColor={t.inkSoft} value={name} onChangeText={setName} />
              <TextInput style={[styles.field, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]} placeholder={s.assetVal} placeholderTextColor={t.inkSoft} keyboardType="numeric" value={val} onChangeText={setVal} />
              <Pressable style={[styles.save, { backgroundColor: t.hibiscus }]} onPress={save} accessibilityRole="button">
                <Text style={styles.saveText}>{s.assetSave}</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable style={[styles.add, { borderColor: t.line, backgroundColor: t.paperWarm }]} onPress={() => setAdding(true)} accessibilityRole="button">
              <Text style={[styles.addText, { color: t.hibiscus }]}>{s.assetAdd}</Text>
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
  card: { borderRadius: 16, padding: 18, overflow: 'hidden', marginBottom: 8 },
  bgFlower: { position: 'absolute', right: -12, bottom: -18, opacity: 0.1 },
  nwLabel: { fontSize: 10, letterSpacing: 2, opacity: 0.6, textTransform: 'uppercase' },
  nwVal: { fontSize: 30, fontWeight: '700', marginVertical: 4 },
  nwIo: { flexDirection: 'row', gap: 22 },
  nwK: { fontSize: 11, opacity: 0.85 },
  nwV: { fontSize: 15, fontWeight: '600', marginTop: 1 },
  sectionHead: { fontSize: 12, fontWeight: '600', marginTop: 10, marginBottom: 7, paddingHorizontal: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 13, padding: 12, marginBottom: 8 },
  emo: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  emoText: { fontSize: 19 },
  name: { fontSize: 14, fontWeight: '600' },
  amt: { fontWeight: '700', fontSize: 14 },
  del: { fontSize: 17, paddingHorizontal: 2, marginLeft: 4 },
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
