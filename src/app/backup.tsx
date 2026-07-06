import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { observer } from '@legendapp/state/react';
import { store$, patchSettings } from '@/store/ledger';
import { importV7 } from '@/migrate/importV7';
import { createBackup, listBackups, restoreBackup, type BackupData } from '@/util/backup';
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
  const [backups, setBackups] = useState<{ name: string; path: string; time: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    const list = await listBackups();
    setBackups(list);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onCreate() {
    setLoading(true);
    try {
      await createBackup();
      setStatus(s.backupCreated);
      await load();
    } finally {
      setLoading(false);
    }
  }

  async function onRestore(path: string) {
    Alert.alert(s.backupRestore, s.backupRestoreConfirm, [
      { text: s.del, style: 'cancel' },
      {
        text: s.backupRestore,
        onPress: async () => {
          try {
            const bd = await restoreBackup(path);
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

  const fmtTime = (ts: number) => new Date(ts).toLocaleDateString();

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
                  <Text style={[styles.backupDate, { color: t.ink }]}>{fmtTime(b.time)}</Text>
                  <Text style={[styles.backupTime, { color: t.inkSoft }]}>
                    {new Date(b.time).toLocaleTimeString()}
                  </Text>
                </View>
                <Tap
                  onPress={() => onRestore(b.path)}
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
  createBtn: { marginTop: 16 },
  status: { marginTop: 10, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  sectionHead: { fontSize: 12, fontWeight: '600', marginTop: 22, marginBottom: 8 },
  empty: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  backupCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: RAD.sm, padding: 12, marginBottom: 8, gap: 10 },
  backupInfo: { flex: 1 },
  backupDate: { fontSize: 14, fontWeight: '600' },
  backupTime: { fontSize: 11, marginTop: 2 },
  restoreBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  restoreBtnText: { fontSize: 12, fontWeight: '700' },
});
