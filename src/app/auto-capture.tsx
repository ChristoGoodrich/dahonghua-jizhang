import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { observer } from '@legendapp/state/react';
import * as capture from '../../modules/notif-capture';
import { store$ } from '@/store/ledger';
import { inbox$, confirmPending, dismissPending, clearUnparsed, drainInbox } from '@/store/inbox';
import { catOf, catName } from '@/domain/cats';
import { fmt } from '@/domain/money';
import { useTheme } from '@/theme/ThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Btn } from '@/components/ui/Btn';
import { Icon } from '@/components/ui/Icon';
import { RAD, shadow } from '@/theme/tokens';
import { I18N } from '@/i18n';

/**
 * Auto-capture setup and the review queue for captures the parser wasn't sure
 * about.
 *
 * Permission state is re-read on every foreground rather than cached: the user
 * leaves this screen to grant access in system settings and comes back, and
 * access can also be revoked later without the app being told.
 */
export default observer(function AutoCaptureScreen() {
  const t = useTheme();
  const lang = store$.lang.get();
  const s = I18N[lang];

  const supported = capture.isSupported();
  const [granted, setGranted] = useState(false);
  const [capturing, setCapturing] = useState(false);

  const refresh = useCallback(() => {
    setGranted(capture.isEnabled());
    setCapturing(capture.isCapturing());
  }, []);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') return;
      refresh();
      void drainInbox().catch(() => {}); // pick up anything captured while away
    });
    return () => sub.remove();
  }, [refresh]);

  function toggleCapture() {
    const next = !capturing;
    capture.setCapturing(next);
    setCapturing(next);
    if (next) void drainInbox().catch(() => {});
  }

  const pending = inbox$.pending.get();
  const unparsed = inbox$.unparsed.get();
  const customCats = store$.customCats.get();

  const Card = ({ children }: { children: React.ReactNode }) => (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'xs')]}>{children}</View>
  );

  const Step = ({ title, desc, action }: { title: string; desc: string; action?: React.ReactNode }) => (
    <View style={[styles.step, { borderBottomColor: t.line }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.stepTitle, { color: t.ink }]}>{title}</Text>
        <Text style={[styles.stepDesc, { color: t.inkSoft }]}>{desc}</Text>
      </View>
      {action}
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScreenHeader title={s.capTitle} subtitle={s.capSub} />
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {!supported ? (
            <Card>
              <Text style={[styles.note, { color: t.inkSoft }]}>{s.capUnsupported}</Text>
            </Card>
          ) : (
            <>
              <Card>
                <Text style={[styles.intro, { color: t.inkSoft }]}>{s.capIntro}</Text>
              </Card>

              <Card>
                <Step
                  title={s.capStepGrant}
                  desc={s.capStepGrantD}
                  action={
                    granted ? (
                      <View style={[styles.badge, { backgroundColor: t.tint }]}>
                        <Icon name="check" color={t.hibiscus} size={14} strokeWidth={2.4} />
                        <Text style={[styles.badgeText, { color: t.hibiscus }]}>{s.capGranted}</Text>
                      </View>
                    ) : (
                      <Btn label={s.capGrant} variant="ghost" onPress={capture.openSettings} />
                    )
                  }
                />
                <Step
                  title={s.capStepOn}
                  desc={s.capStepOnD}
                  action={
                    <Btn
                      label={capturing ? s.capOn : s.capOff}
                      variant={capturing ? 'primary' : 'ghost'}
                      onPress={toggleCapture}
                      disabled={!granted}
                    />
                  }
                />
                <View style={styles.stepLast}>
                  <Text style={[styles.stepTitle, { color: t.ink }]}>{s.capStepAlive}</Text>
                  <Text style={[styles.stepDesc, { color: t.inkSoft }]}>{s.capStepAliveD}</Text>
                </View>
              </Card>

              <Text style={[styles.sectionHead, { color: t.inkSoft }]}>{s.capPending}</Text>
              <Card>
                {pending.length === 0 ? (
                  <Text style={[styles.empty, { color: t.inkSoft }]}>{s.capPendingEmpty}</Text>
                ) : (
                  pending.map((p, i) => {
                    const cat = catOf(p.draft.io, p.draft.cat, customCats);
                    return (
                      <View
                        key={p.id}
                        style={[styles.pending, { borderBottomColor: t.line }, i === pending.length - 1 && styles.stepLast]}
                      >
                        <View style={styles.pendingHead}>
                          <Text style={[styles.amount, { color: p.draft.io === 'inc' ? t.hibiscusDeep : t.ink }]}>
                            {p.draft.io === 'inc' ? '+' : '-'}{fmt(p.draft.amt, lang)}
                          </Text>
                          <Text style={[styles.cat, { color: t.inkSoft }]}>
                            {cat.e} {catName(cat, lang)}
                          </Text>
                        </View>
                        <Text style={[styles.raw, { color: t.inkSoft }]} numberOfLines={2}>{p.raw}</Text>
                        <View style={styles.actions}>
                          <Btn label={s.capConfirm} onPress={() => confirmPending(p.id)} style={styles.action} />
                          <Btn label={s.capDismiss} variant="quiet" onPress={() => dismissPending(p.id)} style={styles.action} />
                        </View>
                      </View>
                    );
                  })
                )}
              </Card>
              <Text style={[styles.note, { color: t.inkSoft }]}>{s.capAcctNote}</Text>

              {unparsed.length > 0 && (
                <>
                  <Text style={[styles.sectionHead, { color: t.inkSoft }]}>{s.capUnparsed}</Text>
                  <Card>
                    <Text style={[styles.stepDesc, { color: t.inkSoft }]}>{s.capUnparsedD}</Text>
                    {unparsed.map((u) => (
                      <View key={u.id} style={[styles.unparsed, { borderTopColor: t.line }]}>
                        <Text style={[styles.pkg, { color: t.inkSoft }]}>{u.pkg}</Text>
                        <Text style={[styles.raw, { color: t.ink }]}>{u.raw}</Text>
                      </View>
                    ))}
                    <Btn label={s.capClear} variant="quiet" onPress={clearUnparsed} style={styles.clear} />
                  </Card>
                </>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  body: { paddingHorizontal: 18, paddingBottom: 40, gap: 12 },
  card: { borderRadius: RAD.lg, borderWidth: 1, padding: 14 },
  intro: { fontSize: 13, lineHeight: 20 },
  note: { fontSize: 12, lineHeight: 18, paddingHorizontal: 4 },
  sectionHead: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4, paddingHorizontal: 4, marginTop: 6 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  stepLast: { borderBottomWidth: 0, paddingTop: 12 },
  stepTitle: { fontSize: 14, fontWeight: '700' },
  stepDesc: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RAD.sm },
  badgeText: { fontSize: 12, fontWeight: '700' },
  empty: { fontSize: 13, textAlign: 'center', paddingVertical: 10 },
  pending: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 6 },
  pendingHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  amount: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  cat: { fontSize: 12 },
  raw: { fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  action: { flex: 1 },
  unparsed: { paddingTop: 10, marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, gap: 3 },
  pkg: { fontSize: 11 },
  clear: { marginTop: 10 },
});
