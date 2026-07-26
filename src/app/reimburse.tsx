import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { observer } from '@legendapp/state/react';
import { store$, confirmReimburse, unmarkReimburse } from '@/store/ledger';
import { catOf, catName } from '@/domain/cats';
import { fmt } from '@/domain/money';
import { useTheme } from '@/theme/ThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { I18N } from '@/i18n';

export default observer(function ReimburseScreen() {
  const t = useTheme();
  const lang = store$.lang.get();
  const s = I18N[lang];
  const data = store$.data.get();
  const customCats = store$.customCats.get();

  const pending = data.filter((d) => d.rb === 'pending' && !d.deletedAt);
  const done = data.filter((d) => d.rb === 'done' && !d.deletedAt);
  const pendSum = pending.reduce((sum, d) => sum + d.amt, 0);
  const doneSum = done.reduce((sum, d) => sum + (d.rbAmt ?? d.amt), 0);
  const items = [...pending, ...done].sort((a, b) => b.ts - a.ts);

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScreenHeader title={s.setReimburse} subtitle={s.setReimburseD} />
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={styles.summ}>
            <View style={[styles.s2, { backgroundColor: t.card }]}>
              <Text style={[styles.s2l, { color: t.inkSoft }]}>{s.rbPending}</Text>
              <Text style={[styles.s2v, { color: '#9A7B45' }]}>{fmt(pendSum, lang)}</Text>
            </View>
            <View style={[styles.s2, { backgroundColor: t.card }]}>
              <Text style={[styles.s2l, { color: t.inkSoft }]}>{s.rbDone}</Text>
              <Text style={[styles.s2v, { color: t.leafDeep }]}>{fmt(doneSum, lang)}</Text>
            </View>
          </View>

          {items.length === 0 ? (
            <Text style={[styles.none, { color: t.inkSoft }]}>{s.rbNone}</Text>
          ) : (
            items.map((d) => {
              const c = catOf(d.io, d.cat, customCats);
              const isP = d.rb === 'pending';
              return (
                <View key={d.id} style={[styles.row, { backgroundColor: t.card }]}>
                  <View style={[styles.emo, { backgroundColor: c.c + '22' }]}>
                    <Text style={styles.emoText}>{c.e}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.nameRow}>
                      <Text style={[styles.name, { color: t.ink }]}>{catName(c, lang)}</Text>
                      <View style={[styles.badge, { backgroundColor: isP ? '#F2DEC8' : '#D6E8DD' }]}>
                        <Text style={[styles.badgeText, { color: isP ? '#9A7B45' : t.leafDeep }]}>{isP ? s.rbPending : s.rbDone}</Text>
                      </View>
                    </View>
                    <Text style={[styles.date, { color: t.inkSoft }]}>
                      {new Date(d.ts).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })}
                      {d.note ? ' · ' + d.note : ''}
                    </Text>
                  </View>
                  <Text style={[styles.amt, { color: t.ink }]}>{fmt(d.amt, lang)}</Text>
                  {isP ? (
                    <Pressable onPress={() => confirmReimburse(d.id)} style={[styles.confirm, { borderColor: t.leaf }]}>
                      <Text style={[styles.confirmText, { color: t.leafDeep }]}>{s.rbConfirm}</Text>
                    </Pressable>
                  ) : (
                    <Pressable onPress={() => unmarkReimburse(d.id)} hitSlop={10}>
                      <Text style={[styles.del, { color: t.inkSoft }]}>✕</Text>
                    </Pressable>
                  )}
                </View>
              );
            })
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
  none: { fontSize: 13, textAlign: 'center', paddingVertical: 30 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 13, padding: 12, marginBottom: 8 },
  emo: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  emoText: { fontSize: 19 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 14, fontWeight: '600' },
  badge: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  date: { fontSize: 11, marginTop: 2 },
  amt: { fontWeight: '700', fontSize: 14 },
  confirm: { borderWidth: 1, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 11, marginLeft: 4 },
  confirmText: { fontSize: 12, fontWeight: '600' },
  del: { fontSize: 17, paddingHorizontal: 2, marginLeft: 4 },
});
