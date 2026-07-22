import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as LocalAuthentication from 'expo-local-authentication';
import { observer } from '@legendapp/state/react';
import { store$, patchSettings, setLang, buildBackup } from '@/store/ledger';
import { importV7 } from '@/migrate/importV7';
import { entriesToCSV } from '@/domain/export';
import { shareTextFile } from '@/util/share';
import { createBackup } from '@/util/backup';
import { scheduleDailyReminder, cancelReminder, isValidTime } from '@/util/reminder';
import { aiConfigured } from '@/ai/client';
import { useTheme } from '@/theme/ThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Tap } from '@/components/ui/Tap';
import { Icon } from '@/components/ui/Icon';
import { Btn } from '@/components/ui/Btn';
import { Group, ValueRow, StackRow } from '@/components/ui/Rows';
import { RAD } from '@/theme/tokens';
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
      const parsed = JSON.parse(text);
      // Import replaces the ledger outright, so snapshot the current data first —
      // it's the only way back if the file turns out to be the wrong one.
      await createBackup().catch(() => {});
      const res = importV7(parsed);
      setStatus(
        res.skipped > 0
          ? `${s.importOk} · ${res.entries} · ${s.importSkipped.replace('%d', String(res.skipped))}`
          : `${s.importOk} · ${res.entries}`,
      );
    } catch {
      setStatus(s.importFail);
    }
  }

  const toggle = (label: React.ReactNode, onPress: () => void, a11y: string) => (
    <Tap
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={[styles.toggleBtn, { borderColor: t.hibiscus, backgroundColor: t.tint }]}
    >
      {typeof label === 'string' ? <Text style={[styles.toggleText, { color: t.hibiscus }]}>{label}</Text> : label}
    </Tap>
  );

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScreenHeader title={s.setTitle} subtitle={s.setSub} />

        {/* Only true preferences live here now — accounts, tools and data moved
            onto the 资产 / 我的 tabs where people actually look for them. */}
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Group title={s.setGroupPref}>
            <ValueRow
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
            <ValueRow
              title={s.remindTitle}
              desc={s.remindDesc}
              last
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
          </Group>

          <Group title={s.setGroupLook}>
            <StackRow title={s.setTheme} desc={s.setThemeD}>
              <ThemePicker lang={lang} currentTheme={settings.theme} />
            </StackRow>
            <ValueRow
              title={s.darkTitle}
              desc={s.darkDesc}
              right={toggle(
                <Icon name={settings.dark ? 'moon' : 'sun'} color={t.hibiscus} size={16} />,
                () => patchSettings({ dark: !settings.dark }),
                s.darkTitle,
              )}
            />
            <ValueRow
              title={s.langTitle}
              desc={s.langDesc}
              last
              right={toggle(lang === 'zh' ? '中' : 'EN', () => setLang(lang === 'zh' ? 'en' : 'zh'), s.langTitle)}
            />
          </Group>

          <Group title={s.setGroupSafety}>
            <ValueRow
              title={s.setLock}
              desc={s.setLockD}
              last={!aiConfigured()}
              right={toggle(settings.lock ? s.lockDisable : s.lockEnable, toggleLock, s.setLock)}
            />
            {aiConfigured() && (
              <ValueRow
                title={s.aiPrivacyTitle}
                desc={s.aiPrivacyDesc}
                last
                right={toggle(
                  settings.aiShareCategories === false ? s.aiShareOff : s.aiShareOn,
                  () => patchSettings({ aiShareCategories: settings.aiShareCategories === false }),
                  s.aiPrivacyTitle,
                )}
              />
            )}
          </Group>

          <Group title={s.setGroupData}>
            <StackRow title={s.dataTitle} desc={s.dataDesc} last>
              <View style={styles.exportRow}>
                <Btn label={s.exportCsv} variant="ghost" onPress={exportCSV} style={styles.exportBtn} />
                <Btn label={s.exportBackup} variant="ghost" onPress={exportBackup} style={styles.exportBtn} />
              </View>
              <Btn label={s.importBtn} onPress={pickAndImport} style={styles.importBtn} />
              {!!status && <Text style={[styles.status, { color: t.leafDeep }]}>{status}</Text>}
            </StackRow>
          </Group>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, maxWidth: 480, width: '100%', alignSelf: 'center' },
  body: { paddingHorizontal: 22, paddingBottom: 60 },
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
