import React from 'react';
import { StyleSheet, ScrollView, View } from 'react-native';
import { observer } from '@legendapp/state/react';
import { store$, setCurLedger } from '@/store/ledger';
import { pickerLedgers } from '@/domain/archive';
import { Chip } from '@/components/ui/Chip';
import { I18N } from '@/i18n';
import type { Lang } from '@/i18n';

/** Filter bar to scope the list to a single ledger (home, list tab). */
export const LedgerFilter = observer(function LedgerFilter({ lang }: { lang: Lang }) {
  const s = I18N[lang];
  const cur = store$.curLedger.get();
  // archived ledgers drop out of the bar, but a ledger that's still the active
  // filter stays so the current scope never silently changes
  const ledgers = pickerLedgers(store$.tags.ledger.get(), store$.settings.archivedLedgers.get() ?? [], cur);
  if (!ledgers.length) return null;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.row} contentContainerStyle={styles.content}>
      <View style={styles.inner}>
        <Chip label={s.ledgerAll} on={cur === ''} onPress={() => setCurLedger('')} />
        {ledgers.map((g) => (
          <Chip key={g} label={g} on={cur === g} onPress={() => setCurLedger(g)} />
        ))}
      </View>
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  row: { maxHeight: 42 },
  content: { paddingHorizontal: 22, paddingTop: 8 },
  inner: { flexDirection: 'row', gap: 7 },
});
