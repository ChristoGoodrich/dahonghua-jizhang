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
import { THEME_KEYS, THEME_SWATCH } from '@/theme/tokens';
import { I18N } from '@/i18n';

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

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.header}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            hitSlop={12}
            style={styles.back}
          >
            <Text style={[styles.backText, { color: t.hibiscus }]}>‹ {s.back}</Text>
          </Pressable>
          <Flower size={28} center="yen" petal={t.hibiscus} stroke={t.hibiscusDeep} />
        </View>
        <Text style={[styles.title, { color: t.ink }]}>{s.setTitle}</Text>
        <Text style={[styles.subtitle, { color: t.inkSoft }]}>{s.setSub}</Text>

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Pressable onPress={() => router.push('/budget')}>
            <Row title={s.setBudgetNav} desc={s.setBudgetNavD} right={<Text style={[styles.chev, { color: t.hibiscus }]}>›</Text>} />
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
            <View style={styles.themes}>
              {THEME_KEYS.map((k) => (
                <Pressable
                  key={k}
                  onPress={() => patchSettings({ theme: k })}
                  style={[
                    styles.themeDot,
                    { backgroundColor: THEME_SWATCH[k] + '22', borderColor: settings.theme === k ? t.ink : 'transparent' },
                  ]}
                >
                  <Flower size={24} petal={THEME_SWATCH[k]} />
                </Pressable>
              ))}
            </View>
          </View>
          <Row
            title={s.darkTitle}
            desc={s.darkDesc}
            right={
              <Pressable
                onPress={() => patchSettings({ dark: !settings.dark })}
                style={[styles.toggleBtn, { borderColor: t.hibiscus }]}
              >
                <Text style={{ fontSize: 16 }}>{settings.dark ? '🌙' : '☀️'}</Text>
              </Pressable>
            }
          />
          <Row
            title={s.langTitle}
            desc={s.langDesc}
            right={
              <Pressable
                onPress={() => setLang(lang === 'zh' ? 'en' : 'zh')}
                style={[styles.toggleBtn, { borderColor: t.hibiscus }]}
              >
                <Text style={[styles.toggleText, { color: t.hibiscus }]}>{lang === 'zh' ? '中' : 'EN'}</Text>
              </Pressable>
            }
          />

          <Pressable onPress={() => router.push('/accounts')}>
            <Row title={s.setAccounts} desc={s.setAccountsD} right={<Text style={[styles.chev, { color: t.hibiscus }]}>›</Text>} />
          </Pressable>
          <Pressable onPress={() => router.push('/assets')}>
            <Row title={s.setAssets} desc={s.setAssetsD} right={<Text style={[styles.chev, { color: t.hibiscus }]}>›</Text>} />
          </Pressable>
          <Pressable onPress={() => router.push('/loans')}>
            <Row title={s.setLoans} desc={s.setLoansD} right={<Text style={[styles.chev, { color: t.hibiscus }]}>›</Text>} />
          </Pressable>
          <Pressable onPress={() => router.push('/subs')}>
            <Row title={s.setSubs} desc={s.setSubsD} right={<Text style={[styles.chev, { color: t.hibiscus }]}>›</Text>} />
          </Pressable>
          <Pressable onPress={() => router.push('/reimburse')}>
            <Row title={s.setReimburse} desc={s.setReimburseD} right={<Text style={[styles.chev, { color: t.hibiscus }]}>›</Text>} />
          </Pressable>
          <Pressable onPress={() => router.push('/templates')}>
            <Row title={s.setTemplates} desc={s.setTemplatesD} right={<Text style={[styles.chev, { color: t.hibiscus }]}>›</Text>} />
          </Pressable>
          <Pressable onPress={() => router.push('/tags')}>
            <Row title={s.setTags} desc={s.setTagsD} right={<Text style={[styles.chev, { color: t.hibiscus }]}>›</Text>} />
          </Pressable>
          <Pressable onPress={() => router.push('/currency')}>
            <Row title={s.setCurrency} desc={s.setCurrencyD} right={<Text style={[styles.chev, { color: t.hibiscus }]}>›</Text>} />
          </Pressable>
          <Pressable onPress={() => router.push('/account')}>
            <Row title={s.setSync} desc={s.setSyncD} right={<Text style={[styles.chev, { color: t.hibiscus }]}>›</Text>} />
          </Pressable>
          <Pressable onPress={() => router.push('/review')}>
            <Row title={s.setReview} desc={s.setReviewD} right={<Text style={[styles.chev, { color: t.hibiscus }]}>›</Text>} />
          </Pressable>
          {aiConfigured() && (
            <Row
              title={s.aiPrivacyTitle}
              desc={s.aiPrivacyDesc}
              right={
                <Pressable
                  onPress={() => patchSettings({ aiShareCategories: settings.aiShareCategories === false })}
                  style={[styles.toggleBtn, { borderColor: t.hibiscus }]}
                >
                  <Text style={[styles.toggleText, { color: t.hibiscus }]}>
                    {settings.aiShareCategories === false ? s.aiShareOff : s.aiShareOn}
                  </Text>
                </Pressable>
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
              <Pressable onPress={toggleLock} style={[styles.toggleBtn, { borderColor: t.hibiscus }]}>
                <Text style={[styles.toggleText, { color: t.hibiscus }]}>{settings.lock ? s.lockDisable : s.lockEnable}</Text>
              </Pressable>
            }
          />

          <View style={[styles.rowCol, { borderBottomWidth: 0 }]}>
            <Text style={[styles.rowTitle, { color: t.ink }]}>{s.dataTitle}</Text>
            <Text style={[styles.rowDesc, { color: t.inkSoft }]}>{s.dataDesc}</Text>
            <View style={styles.exportRow}>
              <Pressable style={[styles.exportBtn, { borderColor: t.line, backgroundColor: t.card }]} onPress={exportCSV}>
                <Text style={[styles.exportText, { color: t.hibiscus }]}>{s.exportCsv}</Text>
              </Pressable>
              <Pressable style={[styles.exportBtn, { borderColor: t.line, backgroundColor: t.card }]} onPress={exportBackup}>
                <Text style={[styles.exportText, { color: t.hibiscus }]}>{s.exportBackup}</Text>
              </Pressable>
            </View>
            <Pressable style={[styles.importBtn, { backgroundColor: t.hibiscus }]} onPress={pickAndImport}>
              <Text style={styles.importText}>{s.importBtn}</Text>
            </Pressable>
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
  back: { paddingVertical: 4 },
  backText: { fontSize: 15, fontWeight: '600' },
  title: { fontSize: 22, fontWeight: '800', paddingHorizontal: 22, marginTop: 6 },
  subtitle: { fontSize: 12, paddingHorizontal: 22, marginTop: 2, marginBottom: 8 },
  body: { paddingHorizontal: 22, paddingBottom: 60 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, gap: 12 },
  rowCol: { paddingVertical: 14, borderBottomWidth: 1 },
  rowTitle: { fontSize: 14, fontWeight: '600' },
  rowDesc: { fontSize: 11.5, marginTop: 2 },
  numInput: { width: 90, borderWidth: 1, borderRadius: 9, paddingVertical: 8, paddingHorizontal: 10, fontSize: 14, textAlign: 'right' },
  themes: { flexDirection: 'row', gap: 10, marginTop: 10 },
  themeDot: { width: 40, height: 40, borderRadius: 20, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  toggleBtn: { borderWidth: 1, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 13, minWidth: 44, alignItems: 'center' },
  toggleText: { fontSize: 13, fontWeight: '700' },
  chev: { fontSize: 20, fontWeight: '700' },
  exportRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  exportBtn: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  exportText: { fontSize: 13, fontWeight: '700' },
  importBtn: { marginTop: 10, borderRadius: 13, padding: 14, alignItems: 'center' },
  importText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  status: { marginTop: 10, fontSize: 13, fontWeight: '600', textAlign: 'center' },
});
