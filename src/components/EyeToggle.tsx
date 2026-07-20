import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { observer } from '@legendapp/state/react';
import { store$, patchSettings } from '@/store/ledger';
import { useTheme } from '@/theme/ThemeContext';
import { Tap } from '@/components/ui/Tap';
import { I18N } from '@/i18n';

/** Header eye that masks balances on the money screens (shoulder-surfing
 *  privacy). Persisted in settings so it stays hidden across launches. */
export const EyeToggle = observer(function EyeToggle() {
  const t = useTheme();
  const s = I18N[store$.lang.get()];
  const hide = store$.settings.hideAmounts.get() === true;
  return (
    <Tap
      onPress={() => patchSettings({ hideAmounts: !hide })}
      hitSlop={10}
      scaleTo={0.9}
      accessibilityRole="button"
      accessibilityState={{ selected: hide }}
      accessibilityLabel={hide ? s.a11yShowAmts : s.a11yHideAmts}
      style={[styles.pill, { backgroundColor: t.card, borderColor: t.line }]}
    >
      <Text style={styles.emoji}>{hide ? '🙈' : '👁️'}</Text>
    </Tap>
  );
});

const styles = StyleSheet.create({
  pill: { borderWidth: 1, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 10 },
  emoji: { fontSize: 14 },
});
