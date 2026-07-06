import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from '@/components/Flower';
import { Tap } from '@/components/ui/Tap';
import { Icon } from '@/components/ui/Icon';
import { THEME_KEYS, THEME_SWATCH, shadow } from '@/theme/tokens';
import { patchSettings } from '@/store/ledger';
import type { ThemeKey } from '@/domain/types';
import type { Lang } from '@/i18n';

const THEME_LABELS: Record<ThemeKey, { zh: string; en: string }> = {
  default: { zh: '大红花', en: 'Hibiscus' },
  sakura: { zh: '樱花', en: 'Sakura' },
  daisy: { zh: '雏菊', en: 'Daisy' },
  jasmine: { zh: '茉莉', en: 'Jasmine' },
  ocean: { zh: '海洋', en: 'Ocean' },
  forest: { zh: '森林', en: 'Forest' },
  sunset: { zh: '晚霞', en: 'Sunset' },
};

export function ThemePicker({ lang, currentTheme }: { lang: Lang; currentTheme: ThemeKey }) {
  const t = useTheme();

  return (
    <View style={styles.grid}>
      {THEME_KEYS.map((k) => {
        const on = currentTheme === k;
        const label = THEME_LABELS[k][lang];
        return (
          <Tap
            key={k}
            onPress={() => patchSettings({ theme: k })}
            scaleTo={0.92}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={label}
            style={[
              styles.option,
              { backgroundColor: THEME_SWATCH[k] + '14' },
              on && { borderColor: THEME_SWATCH[k] },
              on && shadow(t, 'xs'),
            ]}
          >
            <Flower size={28} petal={THEME_SWATCH[k]} />
            <Text style={[styles.label, { color: on ? THEME_SWATCH[k] : t.inkSoft }]} numberOfLines={1}>
              {label}
            </Text>
            {on && (
              <View style={[styles.check, { backgroundColor: THEME_SWATCH[k], borderColor: t.card }]}>
                <Icon name="check" color="#fff" size={9} strokeWidth={3} />
              </View>
            )}
          </Tap>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  option: {
    width: 72,
    height: 72,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
  },
  check: {
    position: 'absolute',
    right: -3,
    top: -3,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
