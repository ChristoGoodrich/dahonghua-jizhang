import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { observer } from '@legendapp/state/react';
import { store$, hydrateCurrentMonth, hydrateFull } from '@/store/ledger';
import { ThemeProvider } from '@/theme/ThemeContext';
import { LockGate } from '@/components/LockGate';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { initAuth } from '@/sync/auth';
import { initSync } from '@/sync/engine';
import { hydrateInbox, startInboxDrain } from '@/store/inbox';

export default observer(function RootLayout() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    hydrateCurrentMonth().finally(() => setReady(true));
    // Full dataset loads after the UI is interactive — InteractionManager waits
    // for animations/transitions to finish, so the main thread is clear.
    import('react-native').then(({ InteractionManager }) => {
      InteractionManager.runAfterInteractions(() => { void hydrateFull(); });
    });
    initAuth().finally(initSync); // restore session, then bind cloud sync (no-op when unconfigured)
  }, []);

  // Drain captured payment notifications on every foreground. No-op unless the
  // Android listener is built, permitted, and switched on. Separate from
  // hydrate() so its AppState subscription is torn down with the tree.
  useEffect(() => {
    let stop: (() => void) | undefined;
    void hydrateInbox().then(() => { stop = startInboxDrain(); });
    return () => stop?.();
  }, []);

  const themeKey = store$.settings.theme.get();
  const dark = !!store$.settings.dark.get();

  if (!ready) return null;

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <ThemeProvider themeKey={themeKey} dark={dark}>
            <StatusBar style={dark ? 'light' : 'dark'} />
            <LockGate>
              <Stack screenOptions={{ headerShown: false }} />
            </LockGate>
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
});
