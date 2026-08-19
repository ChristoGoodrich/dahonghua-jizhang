import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { observer } from '@legendapp/state/react';
import { store$, patchSettings } from '@/store/ledger';
import { importV7 } from '@/migrate/importV7';
import { createBackup, listBackups, restoreBackup, type BackupData, type BackupInfo } from '@/util/backup';
import { useTheme } from '@/theme/ThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Tap } from '@/components/ui/Tap';
import { Btn } from '@/components/ui/Btn';
import { Icon } from '@/components/ui/Icon';
import { RAD, shadow } from '@/theme/tokens';
import { I18N } from '@/i18n';

const FREQ_OPTIONS: { value: 'daily' | 'weekly'; key: 'backupFreqDaily' | 'backupFreqWeekly' }[] = [
  { value: 'daily', key: 'backupFreqDaily' },
  { value: 'weekly', key: 'backupFreqWeekly' },
];

function adaptForImport(bd: BackupData) {
  return { data: bd.entries, settings: bd.config };
}

export default observer(function BackupScreen() {
  const t = useTheme();
  const lang = store$.lang.get();
  const s = I18N[lang];
  const settings = store$.settings.get();
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [encryptEnabled, setEncryptEnabled] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const load = useCallback(async () => {
    const list = await listBackups();
    setBackups(list);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onCreate() {
    if (encryptEnabled) {
      if (!password) {
        setStatus(s.backupPasswordRequired);
        return;
      }
      if (password !== confirmPassword) {
        setStatus(s.backupPasswordMismatch);
        return;
      }
    }
    setLoading(true);
    try {
      await createBackup(MAX_BACKUPS, encryptEnabled ? password : undefined);
      setStatus(s.backupCreated);
      setPassword('');
      setConfirmPassword('');
      await load();
    } finally {
      setLoading(false);
    }
  }

  function promptPasswordAndRestore(path: string) {
    Alert.prompt(
      s.backupPassword,
      s.backupPasswordPh,
      [
        { text: s.cancel, style: 'cancel' },
        {
          text: s.backupRestore,
          style: 'destructive',
          onPress: async (pw?: string) => {
            if (!pw) return;
            try {
              const bd = await restoreBackup(path, pw);
              await createBackup().catch(() => {});
              importV7(adaptForImport(bd));
              setStatus(s.backupRestoreDone);
              await load();
            } catch {
              setStatus(s.importFail);
            }
          },
        },
      ],
      'secure-text',
    );
  }

  async function onRestore(b: BackupInfo) {
    if (b.encrypted) {
      promptPasswordAndRestore(b.path);
      return;
    }
    Alert.alert(s.backupRestore, s.backupRestoreConfirm, [
      { text: s.cancel, style: 'cancel' },
      {
        text: s.backupRestore,
        style: 'destructive',
        onPress: async () => {
          try {
            const bd = await restoreBackup(b.path);
            await createBackup().catch(() => {});
            importV7(adaptForImport(bd));
            setStatus(s.backupRestoreDone);
            await load();
          } catch {
            setStatus(s.importFail);
          }
        },
      },
    ]);
  }

  const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
  const fmtTime = (ts: number) => new Date(ts).toLocaleDateString(locale);

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScreenHeader title={s.backupAuto} subtitle={s.backupAutoD} />
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'xs')]}>
            <View style={styles.row}>
              <View style={styles.rowMid}>
                <Text style={[styles.rowTitle, { color: t.ink }]}>{s.backupAuto}</Text>
                <Text style={[styles.rowDesc, { color: t.inkSoft }]}>{s.backupAutoD}</Text>
              </View>
              <Tap
                onPress={() => patchSettings({ autoBackup: !settings.autoBackup })}
                scaleTo={0.9}
                accessibilityRole="button"
                accessibilityLabel={s.backupAuto}
                style={[styles.toggleBtn, { borderColor: t.hibiscus, backgroundColor: t.tint }]}
              >
                <Text style={[styles.toggleText, { color: t.hibiscus }]}>
                  {settings.autoBackup ? s.lockDisable : s.lockEnable}
                </Text>
              </Tap>
            </View>

            {settings.autoBackup && (
              <View style={styles.freqRow}>
                <Text style={[styles.freqLabel, { color: t.inkSoft }]}>{s.backupFreq}</Text>
                <View style={styles.freqBtns}>
                  {FREQ_OPTIONS.map((opt) => {
                    const on = (settings.backupFrequency ?? 'daily') === opt.value;
                    return (
                      <Tap
                        key={opt.value}
                        onPress={() => patchSettings({ backupFrequency: opt.value })}
                        scaleTo={0.92}
                        accessibilityRole="button"
                        style={[styles.freqBtn, { borderColor: on ? t.hibiscus : t.line, backgroundColor: on ? t.tint : 'transparent' }]}
                      >
                        <Text style={[styles.freqBtnText, { color: on ? t.hibiscus : t.inkSoft }]}>{s[opt.key]}</Text>
                      </Tap>
                    );
                  })}
                </View>
              </View>
            )}
          </View>

          {/* Encryption toggle */}
          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'xs')]}>
            <View style={styles.row}>
              <View style={styles.rowMid}>
                <Text style={[styles.rowTitle, { color: t.ink }]}>{s.backupEncrypt}</Text>
                <Text style={[styles.rowDesc, { color: t.inkSoft }]}>{s.backupEncryptD}</Text>
              </View>
              <Tap
                onPress={() => setEncryptEnabled(!encryptEnabled)}
                scaleTo={0.9}
                accessibilityRole="button"
                accessibilityLabel={s.backupEncrypt}
                style={[styles.toggleBtn, { borderColor: t.hibiscus, backgroundColor: encryptEnabled ? t.tint : 'transparent' }]}
              >
                <Text style={[styles.toggleText, { color: t.hibiscus }]}>
                  {encryptEnabled ? s.lockDisable : s.lockEnable}
                </Text>
              </Tap>
            </View>

            {encryptEnabled && (
              <View style={styles.passwordSection}>
                <TextInput
                  style={[styles.input, { color: t.ink, borderColor: t.line, backgroundColor: t.paper }]}
                  placeholder={s.backupPasswordPh}
                  placeholderTextColor={t.inkSoft}
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                />
                <TextInput
                  style={[styles.input, { color: t.ink, borderColor: t.line, backgroundColor: t.paper }]}
                  placeholder={s.backupPasswordConfirm}
                  placeholderTextColor={t.inkSoft}
                  secureTextEntry
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                />
              </View>
            )}
          </View>

          <Btn
            label={loading ? s.backupCreating : s.backupCreate}
            onPress={onCreate}
            disabled={loading}
            leading={loading ? <ActivityIndicator size="small" color="#fff" /> : undefined}
            style={styles.createBtn}
          />

          {!!status && <Text style={[styles.status, { color: t.leafDeep }]}>{status}</Text>}

          <Text style={[styles.sectionHead, { color: t.inkSoft }]}>{s.backupList}</Text>

          {backups.length === 0 ? (
            <Text style={[styles.empty, { color: t.inkSoft }]}>{s.backupEmpty}</Text>
          ) : (
            backups.map((b) => (
              <View key={b.name} style={[styles.backupCard, { backgroundColor: t.card, borderColor: t.line }]}>
                <View style={styles.backupInfo}>
                  <View style={styles.backupDateRow}>
                    <Text style={[styles.backupDate, { color: t.ink }]}>{fmtTime(b.time)}</Text>
                    {b.encrypted && (
                      <View style={[styles.encryptedBadge, { backgroundColor: t.tint, borderColor: t.hibiscus }]}>
                        <Icon name="lock" color={t.hibiscus} size={10} />
                        <Text style={[styles.encryptedBadgeText, { color: t.hibiscus }]}>{s.backupEncryptedTag}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.backupTime, { color: t.inkSoft }]}>
                    {new Date(b.time).toLocaleTimeString(locale)}
                  </Text>
                </View>
                <Tap
                  onPress={() => onRestore(b)}
                  scaleTo={0.9}
                  accessibilityRole="button"
                  accessibilityLabel={s.backupRestore}
                  style={[styles.restoreBtn, { borderColor: t.hibiscus, backgroundColor: t.tint }]}
                >
                  <Icon name="undo" color={t.hibiscus} size={14} />
                  <Text style={[styles.restoreBtnText, { color: t.hibiscus }]}>{s.backupRestore}</Text>
                </Tap>
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
});

const MAX_BACKUPS = 10;

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, maxWidth: 480, width: '100%', alignSelf: 'center' },
  body: { paddingHorizontal: 22, paddingBottom: 80, paddingTop: 6 },
  card: { borderWidth: 1, borderRadius: RAD.sm, padding: 14, marginTop: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowMid: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: '600' },
  rowDesc: { fontSize: 11.5, marginTop: 2 },
  toggleBtn: { borderWidth: 1, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 13, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  toggleText: { fontSize: 13, fontWeight: '700' },
  freqRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 10 },
  freqLabel: { fontSize: 13 },
  freqBtns: { flexDirection: 'row', gap: 8 },
  freqBtn: { borderWidth: 1, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14 },
  freqBtnText: { fontSize: 13, fontWeight: '600' },
  passwordSection: { marginTop: 12, gap: 8 },
  input: { borderWidth: 1, borderRadius: RAD.sm, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  createBtn: { marginTop: 16 },
  status: { marginTop: 10, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  sectionHead: { fontSize: 12, fontWeight: '600', marginTop: 22, marginBottom: 8 },
  empty: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  backupCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: RAD.sm, padding: 12, marginBottom: 8, gap: 10 },
  backupInfo: { flex: 1 },
  backupDateRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backupDate: { fontSize: 14, fontWeight: '600' },
  backupTime: { fontSize: 11, marginTop: 2 },
  encryptedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 6 },
  encryptedBadgeText: { fontSize: 10, fontWeight: '600' },
  restoreBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  restoreBtnText: { fontSize: 12, fontWeight: '700' },
});
