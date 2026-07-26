import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { observer } from '@legendapp/state/react';
import { store$, addTag, removeTag, archiveLedger } from '@/store/ledger';
import { pickerLedgers, archivedLedgers } from '@/domain/archive';
import type { Tags } from '@/domain/types';
import { useTheme } from '@/theme/ThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { I18N } from '@/i18n';

export default observer(function TagsScreen() {
  const t = useTheme();
  const lang = store$.lang.get();
  const s = I18N[lang];
  const tags = store$.tags.get();
  const archivedL = store$.settings.archivedLedgers.get() ?? [];
  const activeLedgers = pickerLedgers(tags.ledger, archivedL);
  const archivedLedgerList = archivedLedgers(tags.ledger, archivedL);

  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<keyof Tags>('normal');
  const [name, setName] = useState('');

  function save() {
    const nm = name.trim().replace(/[<>]/g, '').slice(0, 16);
    if (!nm) return;
    addTag(type, nm);
    setName('');
    setAdding(false);
  }

  const Section = ({ title, list, kind }: { title: string; list: string[]; kind: keyof Tags }) => (
    <>
      <Text style={[styles.sectionHead, { color: t.inkSoft }]}>{title}</Text>
      <View style={styles.chips}>
        {list.length === 0 ? (
          <Text style={{ fontSize: 12, color: t.inkSoft }}>—</Text>
        ) : (
          list.map((g) => (
            <View key={g} style={[styles.chip, kind === 'ledger' && styles.ledgerChip, { borderColor: t.line, backgroundColor: t.card }]}>
              <Text style={{ fontSize: 12.5, fontWeight: '600', color: t.inkSoft }}>{g}</Text>
              {/* ledgers archive first (keep history), then delete once archived */}
              {kind === 'ledger' ? (
                <Pressable onPress={() => archiveLedger(g, true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={s.archive}>
                  <Text style={{ fontSize: 13, color: t.inkSoft, opacity: 0.6 }}>📥</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => Alert.alert(s.delConfirmTitle, s.delConfirmMsg, [
                  { text: s.cancel, style: 'cancel' },
                  { text: s.delConfirmBtn, style: 'destructive', onPress: () => removeTag(kind, g) },
                ])} hitSlop={8} accessibilityRole="button" accessibilityLabel={s.del}>
                  <Text style={{ fontSize: 13, color: t.inkSoft, opacity: 0.6 }}>✕</Text>
                </Pressable>
              )}
            </View>
          ))
        )}
      </View>
    </>
  );

  // Rendered inline (see below), NOT as a nested zero-prop component — the React
  // Compiler hoists an argument-less inner component as dependency-free and drops
  // its closure over `t`/`s` (→ "t is not defined"). Building a node is safe.
  const archivedLedgersBlock = (
    <>
      <Text style={[styles.sectionHead, { color: t.inkSoft, marginTop: 16 }]}>{s.archivedSection} · {archivedLedgerList.length}</Text>
      <Text style={[styles.archHint, { color: t.inkSoft }]}>{s.archivedHint}</Text>
      <View style={styles.chips}>
        {archivedLedgerList.map((g) => (
          <View key={g} style={[styles.chip, styles.ledgerChip, { borderColor: t.line, backgroundColor: t.card, opacity: 0.7 }]}>
            <Text style={{ fontSize: 12.5, fontWeight: '600', color: t.inkSoft }}>{g}</Text>
            <Pressable onPress={() => archiveLedger(g, false)} hitSlop={8} accessibilityRole="button" accessibilityLabel={s.unarchive}>
              <Text style={{ fontSize: 13, color: t.hibiscus }}>↩</Text>
            </Pressable>
            <Pressable onPress={() => Alert.alert(s.delConfirmTitle, s.delConfirmMsg, [
              { text: s.cancel, style: 'cancel' },
              { text: s.delConfirmBtn, style: 'destructive', onPress: () => removeTag('ledger', g) },
            ])} hitSlop={8} accessibilityRole="button" accessibilityLabel="✕">
              <Text style={{ fontSize: 13, color: t.inkSoft, opacity: 0.6 }}>✕</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </>
  );

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScreenHeader title={s.setTags} subtitle={s.setTagsD} />
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Section title={s.tagNormal} list={tags.normal} kind="normal" />
          <Section title={s.tagLedger} list={activeLedgers} kind="ledger" />
          {archivedLedgerList.length > 0 && archivedLedgersBlock}

          {adding ? (
            <View style={[styles.form, { borderColor: t.line }]}>
              <View style={[styles.toggle, { backgroundColor: t.line }]}>
                {(['normal', 'ledger'] as (keyof Tags)[]).map((k) => (
                  <Pressable key={k} onPress={() => setType(k)} accessibilityRole="button" accessibilityState={{ selected: type === k }} accessibilityLabel={k === 'normal' ? s.tagNormal : s.tagLedger} style={[styles.toggleBtn, type === k && { backgroundColor: t.card }]}>
                    <Text style={[styles.toggleText, { color: type === k ? t.ink : t.inkSoft }]}>{k === 'normal' ? s.tagNormal : s.tagLedger}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput style={[styles.field, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]} placeholder={s.tagName} placeholderTextColor={t.inkSoft} value={name} onChangeText={setName} />
              <View style={styles.formActions}>
                <Pressable style={[styles.cancelBtn, { borderColor: t.line }]} onPress={() => { setAdding(false); setName(''); setType('normal'); }} accessibilityRole="button" accessibilityLabel={s.cancel}>
                  <Text style={[styles.cancelText, { color: t.inkSoft }]}>{s.cancel}</Text>
                </Pressable>
                <Pressable style={[styles.save, { backgroundColor: t.hibiscus }]} onPress={save} accessibilityRole="button" accessibilityLabel={s.tagAdd.replace('＋ ', '')}>
                  <Text style={styles.saveText}>{s.tagAdd.replace('＋ ', '')}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable style={[styles.add, { borderColor: t.line, backgroundColor: t.paperWarm }]} onPress={() => setAdding(true)} accessibilityRole="button" accessibilityLabel={s.tagAdd}>
              <Text style={[styles.addText, { color: t.hibiscus }]}>{s.tagAdd}</Text>
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
  sectionHead: { fontSize: 12, fontWeight: '600', marginTop: 12, marginBottom: 8 },
  archHint: { fontSize: 11, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 18, paddingVertical: 6, paddingHorizontal: 12 },
  ledgerChip: { borderStyle: 'dashed' },
  add: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 12, padding: 12, alignItems: 'center', marginTop: 16 },
  addText: { fontSize: 13, fontWeight: '600' },
  form: { borderWidth: 1, borderRadius: 13, padding: 12, marginTop: 16, gap: 10 },
  toggle: { flexDirection: 'row', borderRadius: 11, padding: 3 },
  toggleBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  toggleText: { fontSize: 13, fontWeight: '600' },
  field: { borderWidth: 1, borderRadius: 11, padding: 11, fontSize: 14 },
  formActions: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, borderWidth: 1, borderRadius: 13, padding: 14, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600' },
  save: { flex: 1, borderRadius: 13, padding: 14, alignItems: 'center' },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
