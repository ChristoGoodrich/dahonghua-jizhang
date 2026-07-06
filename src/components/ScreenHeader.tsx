import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme/ThemeContext';
import { Tap } from '@/components/ui/Tap';
import { Icon } from '@/components/ui/Icon';
import { shadow } from '@/theme/tokens';
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
      <Text style={[styles.title, { color: t.ink }]}>{title}</Text>
      {!!subtitle && <Text style={[styles.subtitle, { color: t.inkSoft }]}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 10 },
  back: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderRadius: 999,
    paddingVertical: 6, paddingLeft: 9, paddingRight: 13,
  },
  backText: { fontSize: 13.5, fontWeight: '700' },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: 0.2, paddingHorizontal: 22, marginTop: 10 },
  subtitle: { fontSize: 12, paddingHorizontal: 22, marginTop: 3, marginBottom: 8 },
});
