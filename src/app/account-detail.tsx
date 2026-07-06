import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { observer } from '@legendapp/state/react';
import { store$ } from '@/store/ledger';
import { acctBalance } from '@/domain/networth';
import { statementSummary } from '@/domain/statement';
import { catOf, catName } from '@/domain/cats';
import { fmt, fmtNum } from '@/domain/money';
import { useTheme } from '@/theme/ThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { I18N } from '@/i18n';
import type { Entry } from '@/domain/types';

const acctEmoji = (kd?: string) => (kd === 'credit' ? '💳' : kd === 'prepaid' ? '🎫' : '👛');

export default observer(function AccountDetailScreen() {
  const t = useTheme();
  const lang = store$.lang.get();
  const s = I18N[lang];
  const { id } = useLocalSearchParams<{ id: string }>();
  const accounts = store$.accounts.get();
  const data = store$.data.get();
  const customCats = store$.customCats.get();

  const account = accounts.find((a) => a.id === id);
  const acctName = (aid?: string) => {
    const a = accounts.find((x) => x.id === aid);
    return a ? (lang === 'zh' ? a.name : a.nameEn || a.name) : s.xferLabel;
  };

  // entries touching this account, newest first, with the delta they applied here
  const rows = useMemo(() => {
    if (!id) return [] as { d: Entry; delta: number }[];
    const out: { d: Entry; delta: number }[] = [];
    for (const d of data) {
      if (d.deletedAt) continue;
      if (d.io === 'xfer') {
        if (d.acct === id) out.push({ d, delta: -(d.amt + (d.fee ?? 0)) });
        else if (d.acctTo === id) out.push({ d, delta: d.amt + (d.discount ?? 0) });
      } else if (d.acct === id || (!d.acct && id === 'default')) {
        out.push({ d, delta: d.io === 'inc' ? d.amt : -d.amt });
      }
    }
    return out.sort((a, b) => b.d.ts - a.d.ts);
  }, [data, id]);

  const bal = account ? acctBalance(account.id, accounts, data) : 0;
  const owed = account?.kind === 'credit' && bal < 0;
  const title = account ? (lang === 'zh' ? account.name : account.nameEn || account.name) : s.setAccounts;

  const stmt = account ? statementSummary(account, accounts, data) : null;
  const dueText = (() => {
    if (!stmt || stmt.dueDate == null || stmt.daysToDue == null) return '';
    const dateStr = new Date(stmt.dueDate).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' });
    const d = stmt.daysToDue;
    const rel = d > 0 ? s.stmtDaysLeft.replace('%d', String(d))
      : d === 0 ? s.stmtDueToday
      : s.stmtOverdue.replace('%d', String(-d));
    return `${dateStr} · ${rel}`;
  })();

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScreenHeader title={`${acctEmoji(account?.kind)} ${title}`} subtitle={s.acctTxTitle} />
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={[styles.balCard, { backgroundColor: t.ink }]}>
            <Text style={[styles.balLabel, { color: t.paper }]}>{owed ? s.acctOwed : s.acctBalance}</Text>
            <Text style={[styles.balVal, { color: t.paper }]}>{fmt(owed ? -bal : bal, lang)}</Text>
          </View>

          {stmt && (
            <View style={[styles.stmtCard, { backgroundColor: t.card, borderColor: t.line }]}>
              <View style={styles.stmtTop}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.stmtLabel, { color: t.inkSoft }]}>{s.stmtBilledDue}</Text>
                  <Text style={[styles.stmtDue, { color: stmt.billedDue > 0 ? t.hibiscus : t.ink }]}>
                    {fmt(stmt.billedDue, lang)}
                  </Text>
                </View>
                {!!dueText && (
                  <View style={styles.stmtDueBox}>
                    <Text style={[styles.stmtLabel, { color: t.inkSoft }]}>{s.stmtDueOn}</Text>
                    <Text style={[styles.stmtDueText, { color: t.ink }]}>{dueText}</Text>
                  </View>
                )}
              </View>
              <View style={[styles.stmtMeta, { borderTopColor: t.line }]}>
                <Text style={[styles.stmtMetaText, { color: t.inkSoft }]}>
                  {s.stmtUnbilled} {fmt(stmt.unbilled, lang)}
                </Text>
                {stmt.overpay > 0 && (
                  <Text style={[styles.stmtMetaText, { color: t.leafDeep }]}>
                    {s.stmtOverpay} {fmt(stmt.overpay, lang)}
                  </Text>
                )}
              </View>
            </View>
          )}

          {rows.length === 0 ? (
            <Text style={[styles.empty, { color: t.inkSoft }]}>{s.empty}</Text>
          ) : (
            rows.map(({ d, delta }) => {
              const isXfer = d.io === 'xfer';
              const c = isXfer ? null : catOf(d.io, d.cat, customCats);
              const dateStr = new Date(d.ts).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' });
              return (
                <View key={d.id} style={[styles.row, { backgroundColor: t.card }]}>
                  <View style={[styles.emo, { backgroundColor: isXfer ? t.line : c!.c + '22' }]}>
                    <Text style={styles.emoText}>{isXfer ? '🔄' : c!.e}</Text>
                  </View>
                  <View style={styles.mid}>
                    <Text style={[styles.cat, { color: t.ink }]} numberOfLines={1}>
                      {isXfer ? `${acctName(d.acct)} → ${acctName(d.acctTo)}` : catName(c!, lang)}
                    </Text>
                    <Text style={[styles.sub, { color: t.inkSoft }]} numberOfLines={1}>
                      {dateStr}{d.note ? ` · ${d.note}` : ''}
                    </Text>
                  </View>
                  <Text style={[styles.amt, { color: delta >= 0 ? t.leafDeep : t.ink }]}>
                    {delta >= 0 ? '+' : '-'}{fmtNum(Math.abs(delta))}
                  </Text>
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
  balCard: { borderRadius: 16, padding: 18, marginBottom: 14 },
  balLabel: { fontSize: 11, letterSpacing: 2, opacity: 0.6, textTransform: 'uppercase' },
  balVal: { fontSize: 30, fontWeight: '800', marginTop: 4 },
  stmtCard: { borderWidth: 1, borderRadius: 14, padding: 15, marginBottom: 14 },
  stmtTop: { flexDirection: 'row', alignItems: 'flex-start' },
  stmtLabel: { fontSize: 11, marginBottom: 3 },
  stmtDue: { fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] },
  stmtDueBox: { alignItems: 'flex-end' },
  stmtDueText: { fontSize: 13, fontWeight: '700' },
  stmtMeta: { flexDirection: 'row', gap: 14, borderTopWidth: 1, marginTop: 12, paddingTop: 10 },
  stmtMetaText: { fontSize: 12, fontWeight: '600' },
  empty: { textAlign: 'center', paddingVertical: 40, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 13, padding: 11, paddingHorizontal: 13, marginBottom: 7 },
  emo: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  emoText: { fontSize: 19 },
  mid: { flex: 1, minWidth: 0 },
  cat: { fontSize: 14, fontWeight: '600' },
  sub: { fontSize: 11.5, marginTop: 1 },
  amt: { fontWeight: '700', fontSize: 15 },
});
