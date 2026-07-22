import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { observer } from '@legendapp/state/react';
import { store$ } from '@/store/ledger';
import { acctBalances, netWorthParts } from '@/domain/networth';
import { fmt } from '@/domain/money';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from '@/components/Flower';
import { EyeToggle } from '@/components/EyeToggle';
import { Tap } from '@/components/ui/Tap';
import { Icon, type IconName } from '@/components/ui/Icon';
import { GradientFill } from '@/components/ui/GradientFill';
import { Group, NavRow } from '@/components/ui/Rows';
import { RAD, TABULAR, shadow } from '@/theme/tokens';
import { I18N, type Lang } from '@/i18n';

/** Credit cards get the card glyph; cash and stored-value both read as a wallet. */
const acctIcon = (kind?: string): IconName => (kind === 'credit' ? 'card' : 'wallet');

/** 资产 tab — everything you hold or owe, one level deep.
 *  Net worth on top, then the live account balances (the number people open the
 *  app for), then the manual/edge cases as drill-downs. */
export const AssetsView = observer(function AssetsView({ lang }: { lang: Lang }) {
  const t = useTheme();
  const s = I18N[lang];
  const router = useRouter();
  const accounts = store$.accounts.get();
  const data = store$.data.get();
  const assets = store$.assets.get();
  const loans = store$.loans.get();
  const hide = store$.settings.hideAmounts.get() === true;

  const m = (v: number) => (hide ? '****' : fmt(v, lang));
  const glyph = (name: IconName) => <Icon name={name} color={t.hibiscus} size={19} strokeWidth={1.7} />;
  const p = netWorthParts(accounts, data, assets, loans);
  const balances = acctBalances(accounts, data);
  const active = accounts.filter((a) => !a.archived);
  const openLoans = loans.filter((l) => l.amt - (l.repaid ?? 0) > 0.005).length;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.headRow}>
        <Text style={[styles.screenTitle, { color: t.ink }]}>{s.assets}</Text>
        <EyeToggle />
      </View>

      <View style={[styles.net, { backgroundColor: t.ink }, shadow(t, 'md')]}>
        <GradientFill from={t.gradFrom} to={t.gradTo} direction="diagonal" opacity={t.isDark ? 0.09 : 0.16} />
        <View style={styles.bgFlower}>
          <Flower size={116} petal={t.paper} stamen={t.paper} />
        </View>
        <Text style={[styles.netLabel, { color: t.paper }]}>{s.assetNet}</Text>
        <Text style={[styles.netVal, TABULAR, { color: t.paper }]} numberOfLines={1} adjustsFontSizeToFit>
          {m(p.net)}
        </Text>
        <View style={styles.netIo}>
          <View style={styles.netCol}>
            <Text style={[styles.netK, { color: t.paper }]}>{s.assetTotal}</Text>
            <Text style={[styles.netV, TABULAR, { color: '#9DC4B3' }]}>{m(p.asset)}</Text>
          </View>
          <View style={styles.netCol}>
            <Text style={[styles.netK, { color: t.paper }]}>{s.assetDebt}</Text>
            <Text style={[styles.netV, TABULAR, { color: t.hibiscusSoft }]}>{m(p.liab)}</Text>
          </View>
        </View>
      </View>

      <Text style={[styles.groupHead, { color: t.inkSoft }]}>{s.asAccounts}</Text>
      {active.length === 0 ? (
        <Text style={[styles.empty, { color: t.inkSoft }]}>{s.asEmpty}</Text>
      ) : (
        active.map((a) => {
          const bal = balances.get(a.id) ?? 0;
          const owed = a.kind === 'credit' && bal < 0;
          return (
            <Tap
              key={a.id}
              onPress={() => router.push(`/account-detail?id=${a.id}`)}
              accessibilityRole="button"
              accessibilityLabel={lang === 'zh' ? a.name : a.nameEn || a.name}
              style={[styles.acct, { backgroundColor: t.card, borderColor: t.line }]}
            >
              <View style={[styles.emo, { backgroundColor: t.paperWarm }]}>
                <Icon name={acctIcon(a.kind)} color={owed ? t.hibiscus : t.inkSoft} size={19} strokeWidth={1.7} />
              </View>
              <View style={styles.acctMid}>
                <Text style={[styles.acctName, { color: t.ink }]} numberOfLines={1}>
                  {lang === 'zh' ? a.name : a.nameEn || a.name}
                </Text>
                <Text style={[styles.acctSub, { color: owed ? t.hibiscus : t.inkSoft }]}>
                  {owed ? s.acctOwed : s.acctBalance}
                </Text>
              </View>
              <Text style={[styles.acctAmt, TABULAR, { color: owed ? t.hibiscus : t.ink }]}>
                {m(owed ? -bal : bal)}
              </Text>
              <Icon name="chevR" color={t.inkSoft} size={15} strokeWidth={2} />
            </Tap>
          );
        })
      )}

      <Group>
        <NavRow lead={glyph('wallet')} title={s.asManage} desc={s.asManageD} onPress={() => router.push('/accounts')} />
        <NavRow
          lead={glyph('layers')}
          title={s.asOther}
          desc={assets.length > 0 ? `${assets.length} · ${s.asOtherD}` : s.asOtherD}
          onPress={() => router.push('/assets')}
        />
        <NavRow
          lead={glyph('swap')}
          title={s.setLoans}
          desc={openLoans > 0 ? `${openLoans} · ${s.setLoansD}` : s.setLoansD}
          onPress={() => router.push('/loans')}
        />
        <NavRow lead={glyph('globe')} title={s.setCurrency} desc={s.setCurrencyD} onPress={() => router.push('/currency')} last />
      </Group>
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 22, paddingTop: 2, paddingBottom: 140 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  screenTitle: { fontSize: 20, fontWeight: '800', letterSpacing: 0.2 },
  net: { borderRadius: RAD.lg, padding: 20, paddingBottom: 16, overflow: 'hidden', zIndex: 0 },
  bgFlower: { position: 'absolute', right: -20, bottom: -30, opacity: 0.1 },
  netLabel: { fontSize: 11, letterSpacing: 2.5, opacity: 0.62, fontWeight: '600' },
  netVal: { fontSize: 34, fontWeight: '800', letterSpacing: -0.6, marginTop: 4, marginBottom: 12 },
  netIo: { flexDirection: 'row', gap: 28 },
  netCol: { gap: 2 },
  netK: { fontSize: 12, opacity: 0.75, fontWeight: '600' },
  netV: { fontSize: 16, fontWeight: '700' },
  groupHead: { fontSize: 11.5, fontWeight: '700', letterSpacing: 1.2, marginTop: 20, marginBottom: 7, marginLeft: 4 },
  empty: { fontSize: 12.5, paddingVertical: 10, paddingHorizontal: 4 },
  acct: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: RAD.md, borderWidth: StyleSheet.hairlineWidth,
    padding: 11, paddingHorizontal: 13, marginBottom: 8,
  },
  emo: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  acctMid: { flex: 1, minWidth: 0 },
  acctName: { fontSize: 14.5, fontWeight: '600' },
  acctSub: { fontSize: 11.5, marginTop: 2 },
  acctAmt: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
});
