import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { observer } from '@legendapp/state/react';
import { store$, hydrate } from '@/store/ledger';
import { ThemeProvider } from '@/theme/ThemeContext';
import { LockGate } from '@/components/LockGate';
import { initAuth } from '@/sync/auth';
import { initSync } from '@/sync/engine';

export default observer(function RootLayout() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    hydrate().finally(() => setReady(true));
    initAuth().finally(initSync); // restore session, then bind cloud sync (no-op when unconfigured)
  }, []);

  const themeKey = store$.settings.theme.get();
  const dark = !!store$.settings.dark.get();

  if (!ready) return null;

  return (
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
  );
});
