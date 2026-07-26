import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { observer } from '@legendapp/state/react';
import { store$ } from '@/store/ledger';
import { isSyncConfigured } from '@/sync/supabase';
import { auth$, sendOtp, verifyOtp, signOut } from '@/sync/auth';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from '@/components/Flower';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SyncIndicator } from '@/components/SyncIndicator';
import { I18N } from '@/i18n';

export default observer(function AccountScreen() {
  const t = useTheme();
  const s = I18N[store$.lang.get()];
  const configured = isSyncConfigured();
  const email = auth$.email.get();
  const signedIn = !!auth$.session.get();

  const [emailInput, setEmailInput] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSend() {
    if (!emailInput.trim()) return;
    setBusy(true);
    const ok = await sendOtp(emailInput);
    setBusy(false);
    setStatus(ok ? s.syncCodeSent : s.syncFailed);
    if (ok) setSent(true);
  }

  async function onVerify() {
    if (!code.trim()) return;
    setBusy(true);
    const ok = await verifyOtp(emailInput, code);
    setBusy(false);
    if (!ok) setStatus(s.syncFailed);
  }

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScreenHeader title={s.setSync} subtitle={s.setSyncD} />
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <Flower size={56} center="yen" petal={t.hibiscus} stroke={t.hibiscusDeep} />
          </View>

          {!configured ? (
            <Text style={[styles.note, { color: t.inkSoft }]}>{s.syncNotConfigured}</Text>
          ) : signedIn ? (
            <>
              <Text style={[styles.signedLabel, { color: t.inkSoft }]}>{s.syncSignedInAs}</Text>
              <Text style={[styles.signedEmail, { color: t.ink }]}>{email}</Text>
              <SyncIndicator />
              <Pressable style={[styles.btn, { borderColor: t.line, backgroundColor: t.card }]} onPress={signOut}>
                <Text style={[styles.btnOutlineText, { color: t.hibiscus }]}>{s.syncSignOut}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={[styles.label, { color: t.inkSoft }]}>{s.syncEmail}</Text>
              <TextInput
                style={[styles.field, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
                placeholder="you@example.com"
                placeholderTextColor={t.inkSoft}
                autoCapitalize="none"
                keyboardType="email-address"
                value={emailInput}
                onChangeText={setEmailInput}
              />
              {!sent ? (
                <Pressable style={[styles.btn, { backgroundColor: t.hibiscus }]} onPress={onSend} disabled={busy}>
                  <Text style={styles.btnText}>{s.syncSendCode}</Text>
                </Pressable>
              ) : (
                <>
                  <Text style={[styles.label, { color: t.inkSoft }]}>{s.syncCode}</Text>
                  <TextInput
                    style={[styles.field, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
                    placeholder="123456"
                    placeholderTextColor={t.inkSoft}
                    keyboardType="number-pad"
                    value={code}
                    onChangeText={setCode}
                  />
                  <Pressable style={[styles.btn, { backgroundColor: t.hibiscus }]} onPress={onVerify} disabled={busy}>
                    <Text style={styles.btnText}>{s.syncVerify}</Text>
                  </Pressable>
                </>
              )}
              {!!status && <Text style={[styles.status, { color: t.leafDeep }]}>{status}</Text>}
            </>
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
  hero: { alignItems: 'center', paddingVertical: 18 },
  note: { fontSize: 13, lineHeight: 20, textAlign: 'center', paddingHorizontal: 8 },
  label: { fontSize: 12, fontWeight: '600', marginTop: 12, marginBottom: 6 },
  field: { borderWidth: 1, borderRadius: 11, padding: 12, fontSize: 14 },
  btn: { borderRadius: 13, padding: 14, alignItems: 'center', marginTop: 14, borderWidth: 1, borderColor: 'transparent' },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnOutlineText: { fontSize: 15, fontWeight: '700' },
  signedLabel: { fontSize: 12, textAlign: 'center' },
  signedEmail: { fontSize: 16, fontWeight: '700', textAlign: 'center', marginTop: 2 },
  status: { marginTop: 12, fontSize: 13, fontWeight: '600', textAlign: 'center' },
});
