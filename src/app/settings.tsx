import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as LocalAuthentication from 'expo-local-authentication';
import { observer } from '@legendapp/state/react';
import { store$, patchSettings, setLang, buildBackup } from '@/store/ledger';
import { importV7 } from '@/migrate/importV7';
import { entriesToCSV } from '@/domain/export';
import { shareTextFile } from '@/util/share';
import { scheduleDailyReminder, cancelReminder, isValidTime } from '@/util/reminder';
import { aiConfigured } from '@/ai/client';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from '@/components/Flower';
import { Tap } from '@/components/ui/Tap';
import { Icon } from '@/components/ui/Icon';
import { Btn } from '@/components/ui/Btn';
import { RAD, shadow } from '@/theme/tokens';
import { I18N } from '@/i18n';
import { ThemePicker } from '@/features/settings/ThemePicker';

async function readFileText(uri: string): Promise<string> {
  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    return res.text();
  }
  const FS: any = await import('expo-file-system');
  return new FS.File(uri).text();
}

export default observer(function SettingsScreen() {
  const t = useTheme();
  const router = useRouter();
  const lang = store$.lang.get();
  const s = I18N[lang];
  const settings = store$.settings.get();
  const [status, setStatus] = useState('');

  async function toggleLock() {
    if (settings.lock) {
      patchSettings({ lock: false });
      return;
    }
    // enabling: confirm the device can actually authenticate first
    try {
      const has = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (has && enrolled) {
        const res = await LocalAuthentication.authenticateAsync({ promptMessage: s.lockPrompt });
        if (!res.success) return;
      }
    } catch {
      // unsupported (e.g. web) — enable anyway; the lock gate unlocks gracefully there
    }
    patchSettings({ lock: true });
  }

  async function onReminderChange(v: string) {
    const time = v.trim();
    if (!time) {
      patchSettings({ remindTime: undefined });
      await cancelReminder();
      return;
    }
    if (isValidTime(time)) {
      patchSettings({ remindTime: time });
      await scheduleDailyReminder(time, s.title, s.remindBody);
    }
  }

  async function exportCSV() {
    const csv = entriesToCSV(store$.data.peek(), store$.accounts.peek(), store$.customCats.peek());
    await shareTextFile('大红花记账.csv', csv, 'text/csv');
    setStatus(s.exportDone);
  }

  async function exportBackup() {
    const json = JSON.stringify(buildBackup(), null, 2);
    await shareTextFile('大红花记账-备份.json', json, 'application/json');
    setStatus(s.exportDone);
  }

  async function pickAndImport() {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: ['application/json', '*/*'], copyToCacheDirectory: true });
      if (r.canceled || !r.assets?.length) return;
      const text = await readFileText(r.assets[0].uri);
      const res = importV7(JSON.parse(text));
      setStatus(`${s.importOk} · ${res.entries}`);
    } catch {
      setStatus(s.importFail);
    }
  }

  const Row = ({ title, desc, right }: { title: string; desc?: string; right: React.ReactNode }) => (
    <View style={[styles.row, { borderBottomColor: t.line }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: t.ink }]}>{title}</Text>
        {!!desc && <Text style={[styles.rowDesc, { color: t.inkSoft }]}>{desc}</Text>}
      </View>
      {right}
    </View>
  );

  const chev = <Icon name="chevR" color={t.hibiscus} size={17} strokeWidth={2} />;

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.header}>
          <Tap
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            hitSlop={12}
            scaleTo={0.92}
            accessibilityRole="button"
            accessibilityLabel={s.back}
            style={[styles.back, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'xs')]}
          >
            <Icon name="chevL" color={t.hibiscus} size={15} strokeWidth={2.2} />
            <Text style={[styles.backText, { color: t.hibiscus }]}>{s.back}</Text>
          </Tap>
          <Flower size={28} center="yen" petal={t.hibiscus} stroke={t.hibiscusDeep} />
        </View>
        <Text style={[styles.title, { color: t.ink }]}>{s.setTitle}</Text>
        <Text style={[styles.subtitle, { color: t.inkSoft }]}>{s.setSub}</Text>

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Pressable onPress={() => router.push('/budget')}>
            <Row title={s.setBudgetNav} desc={s.setBudgetNavD} right={chev} />
          </Pressable>
          <Row
            title={s.setCycle}
            desc={s.setCycleD}
            right={
              <TextInput
                style={[styles.numInput, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
                keyboardType="numeric"
                value={String(settings.cycleStart || 1)}
                onChangeText={(v) => {
                  const n = Math.max(1, Math.min(28, parseInt(v.replace(/[^\d]/g, ''), 10) || 1));
                  patchSettings({ cycleStart: n });
                }}
              />
            }
          />
          <View style={[styles.rowCol, { borderBottomColor: t.line }]}>
            <Text style={[styles.rowTitle, { color: t.ink }]}>{s.setTheme}</Text>
            <Text style={[styles.rowDesc, { color: t.inkSoft }]}>{s.setThemeD}</Text>
            <ThemePicker lang={lang} currentTheme={settings.theme} />
          </View>
          <Row
            title={s.darkTitle}
            desc={s.darkDesc}
            right={
              <Tap
                onPress={() => patchSettings({ dark: !settings.dark })}
                scaleTo={0.9}
                accessibilityRole="button"
                accessibilityLabel={s.darkTitle}
                style={[styles.toggleBtn, { borderColor: t.hibiscus, backgroundColor: t.tint }]}
              >
                <Icon name={settings.dark ? 'moon' : 'sun'} color={t.hibiscus} size={16} />
              </Tap>
            }
          />
          <Row
            title={s.langTitle}
            desc={s.langDesc}
            right={
              <Tap
                onPress={() => setLang(lang === 'zh' ? 'en' : 'zh')}
                scaleTo={0.9}
                accessibilityRole="button"
                accessibilityLabel={s.langTitle}
                style={[styles.toggleBtn, { borderColor: t.hibiscus, backgroundColor: t.tint }]}
              >
                <Text style={[styles.toggleText, { color: t.hibiscus }]}>{lang === 'zh' ? '中' : 'EN'}</Text>
              </Tap>
            }
          />

          <Pressable onPress={() => router.push('/accounts')}>
            <Row title={s.setAccounts} desc={s.setAccountsD} right={chev} />
          </Pressable>
          <Pressable onPress={() => router.push('/assets')}>
            <Row title={s.setAssets} desc={s.setAssetsD} right={chev} />
          </Pressable>
          <Pressable onPress={() => router.push('/loans')}>
            <Row title={s.setLoans} desc={s.setLoansD} right={chev} />
          </Pressable>
          <Pressable onPress={() => router.push('/subs')}>
            <Row title={s.setSubs} desc={s.setSubsD} right={chev} />
          </Pressable>
          <Pressable onPress={() => router.push('/reimburse')}>
            <Row title={s.setReimburse} desc={s.setReimburseD} right={chev} />
          </Pressable>
          <Pressable onPress={() => router.push('/templates')}>
            <Row title={s.setTemplates} desc={s.setTemplatesD} right={chev} />
          </Pressable>
          <Pressable onPress={() => router.push('/tags')}>
            <Row title={s.setTags} desc={s.setTagsD} right={chev} />
          </Pressable>
          <Pressable onPress={() => router.push('/backup')}>
            <Row title={s.backupAuto} desc={s.backupAutoD} right={chev} />
          </Pressable>
          <Pressable onPress={() => router.push('/import-bills')}>
            <Row title={s.billImportNav} desc={s.billImportNavD} right={chev} />
          </Pressable>
          <Pressable onPress={() => router.push('/currency')}>
            <Row title={s.setCurrency} desc={s.setCurrencyD} right={chev} />
          </Pressable>
          <Pressable onPress={() => router.push('/account')}>
            <Row title={s.setSync} desc={s.setSyncD} right={chev} />
          </Pressable>
          <Pressable onPress={() => router.push('/review')}>
            <Row title={s.setReview} desc={s.setReviewD} right={chev} />
          </Pressable>
          <Pressable onPress={() => router.push('/feedback')}>
            <Row title={lang === 'zh' ? '意见反馈' : 'Feedback'} desc={lang === 'zh' ? '你的建议让大红花更好' : 'Help us improve Red Blossom'} right={chev} />
          </Pressable>
          {aiConfigured() && (
            <Row
              title={s.aiPrivacyTitle}
              desc={s.aiPrivacyDesc}
              right={
                <Tap
                  onPress={() => patchSettings({ aiShareCategories: settings.aiShareCategories === false })}
                  scaleTo={0.9}
                  accessibilityRole="button"
                  accessibilityLabel={s.aiPrivacyTitle}
                  style={[styles.toggleBtn, { borderColor: t.hibiscus, backgroundColor: t.tint }]}
                >
                  <Text style={[styles.toggleText, { color: t.hibiscus }]}>
                    {settings.aiShareCategories === false ? s.aiShareOff : s.aiShareOn}
                  </Text>
                </Tap>
              }
            />
          )}
          <Row
            title={s.remindTitle}
            desc={s.remindDesc}
            right={
              <TextInput
                style={[styles.numInput, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
                placeholder="21:00"
                placeholderTextColor={t.inkSoft}
                defaultValue={settings.remindTime ?? ''}
                onEndEditing={(e) => onReminderChange(e.nativeEvent.text)}
              />
            }
          />
          <Row
            title={s.setLock}
            desc={s.setLockD}
            right={
              <Tap
                onPress={toggleLock}
                scaleTo={0.9}
                accessibilityRole="button"
                accessibilityLabel={s.setLock}
                style={[styles.toggleBtn, { borderColor: t.hibiscus, backgroundColor: t.tint }]}
              >
                <Text style={[styles.toggleText, { color: t.hibiscus }]}>{settings.lock ? s.lockDisable : s.lockEnable}</Text>
              </Tap>
            }
          />

          <View style={[styles.rowCol, { borderBottomWidth: 0 }]}>
            <Text style={[styles.rowTitle, { color: t.ink }]}>{s.dataTitle}</Text>
            <Text style={[styles.rowDesc, { color: t.inkSoft }]}>{s.dataDesc}</Text>
            <View style={styles.exportRow}>
              <Btn label={s.exportCsv} variant="ghost" onPress={exportCSV} style={styles.exportBtn} />
              <Btn label={s.exportBackup} variant="ghost" onPress={exportBackup} style={styles.exportBtn} />
            </View>
            <Btn label={s.importBtn} onPress={pickAndImport} style={styles.importBtn} />
            {!!status && <Text style={[styles.status, { color: t.leafDeep }]}>{status}</Text>}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, maxWidth: 480, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 10 },
  back: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderRadius: 999,
    paddingVertical: 6, paddingLeft: 9, paddingRight: 13,
  },
  backText: { fontSize: 13.5, fontWeight: '700' },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: 0.2, paddingHorizontal: 22, marginTop: 10 },
  subtitle: { fontSize: 12, paddingHorizontal: 22, marginTop: 3, marginBottom: 8 },
  body: { paddingHorizontal: 22, paddingBottom: 60 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  rowCol: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  rowTitle: { fontSize: 14, fontWeight: '600' },
  rowDesc: { fontSize: 11.5, marginTop: 2, lineHeight: 16 },
  numInput: {
    width: 90, borderWidth: StyleSheet.hairlineWidth, borderRadius: RAD.xs,
    paddingVertical: 8, paddingHorizontal: 10, fontSize: 14, textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  toggleBtn: {
    borderWidth: 1, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 13,
    minWidth: 44, alignItems: 'center', justifyContent: 'center',
  },
  toggleText: { fontSize: 13, fontWeight: '700' },
  exportRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  exportBtn: { flex: 1 },
  importBtn: { marginTop: 10 },
  status: { marginTop: 10, fontSize: 13, fontWeight: '600', textAlign: 'center' },
});
