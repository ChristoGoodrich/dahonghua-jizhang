import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from '@/components/Flower';
import { store$ } from '@/store/ledger';
import { I18N } from '@/i18n';

/** Shared back-header + title for the settings sub-screens. */
export function ScreenHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const t = useTheme();
  const router = useRouter();
  const s = I18N[store$.lang.get()];
  return (
    <View>
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
      <Text style={[styles.title, { color: t.ink }]}>{title}</Text>
      {!!subtitle && <Text style={[styles.subtitle, { color: t.inkSoft }]}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 10 },
  back: { paddingVertical: 4 },
  backText: { fontSize: 15, fontWeight: '600' },
  title: { fontSize: 22, fontWeight: '800', paddingHorizontal: 22, marginTop: 6 },
  subtitle: { fontSize: 12, paddingHorizontal: 22, marginTop: 2, marginBottom: 8 },
});
