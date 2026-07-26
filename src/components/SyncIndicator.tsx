import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { observer } from '@legendapp/state/react';
import { sync$, retrySync } from '@/sync/engine';
import { useTheme } from '@/theme/ThemeContext';
import { Icon } from '@/components/ui/Icon';
import { Tap } from '@/components/ui/Tap';
import { I18N } from '@/i18n';
import { store$ } from '@/store/ledger';

export const SyncIndicator = observer(function SyncIndicator() {
  const t = useTheme();
  const lang = store$.lang.get();
  const s = I18N[lang];
  const { status } = sync$.get();

  const isSyncing = status === 'syncing';
  const isError = status === 'error';
  const isSynced = status === 'synced';

  const iconColor = isError ? t.hibiscus : isSynced ? t.leafDeep : t.inkSoft;

  const label = status === 'off' ? s.syncOff
    : status === 'syncing' ? s.syncSyncing
    : status === 'synced' ? s.syncSynced
    : s.syncError;

  return (
    <Tap
      onPress={isError ? retrySync : undefined}
      accessibilityRole={isError ? 'button' : 'text'}
      accessibilityLabel={label}
      style={styles.row}
    >
      <View style={styles.iconWrap}>
        {isSyncing ? (
          <ActivityIndicator size="small" color={t.inkSoft} />
        ) : (
          <Icon name="cloud" color={iconColor} size={18} />
        )}
      </View>
      <Text style={[styles.label, { color: isError ? t.hibiscus : t.inkSoft }]}>{label}</Text>
      {isError && (
        <Text style={[styles.retry, { color: t.hibiscus }]}>{s.lockRetry}</Text>
      )}
    </Tap>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  iconWrap: { width: 18, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 13, flex: 1 },
  retry: { fontSize: 13, fontWeight: '600' },
});
