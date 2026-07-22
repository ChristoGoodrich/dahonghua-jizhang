import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { observer } from '@legendapp/state/react';
import { store$, patchSettings } from '@/store/ledger';
import { useTheme } from '@/theme/ThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { GardenView, GOAL_DEFAULT } from '@/features/garden/GardenView';
import { inCycle } from '@/domain/cycle';
import { streakDays } from '@/domain/streak';
import { I18N } from '@/i18n';

/** The flower wall, promoted out of the old 4th tab into its own screen
 *  (reached from the 我的 hub card). */
export default observer(function GardenScreen() {
  const t = useTheme();
  const lang = store$.lang.get();
  const s = I18N[lang];
  const data = store$.data.get();
  const settings = store$.settings.get();
  const cycleStart = settings.cycleStart || 1;

  const live = useMemo(() => data.filter((d) => !d.deletedAt), [data]);
  const count = useMemo(
    () => live.filter((d) => inCycle(d.ts, new Date(), cycleStart)).length,
    [live, cycleStart],
  );
  const streak = useMemo(() => streakDays(live.map((d) => d.ts)), [live]);

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        {/* the card below already carries wallTitle/wallSub — header stays short */}
        <ScreenHeader title={s.wall} />
        <GardenView
          count={count}
          streak={streak}
          lang={lang}
          goal={settings.gardenGoal ?? GOAL_DEFAULT}
          onGoalChange={(g) => patchSettings({ gardenGoal: g })}
        />
      </SafeAreaView>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, maxWidth: 480, width: '100%', alignSelf: 'center' },
});
