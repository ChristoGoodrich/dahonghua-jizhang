import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { observer } from '@legendapp/state/react';
import { store$ } from '@/store/ledger';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from './Flower';
import { I18N } from '@/i18n';

/** Gates app content behind device biometric/passcode auth when the lock is on.
 *  Where auth is unavailable (web, no enrolled biometrics) it unlocks gracefully. */
export const LockGate = observer(function LockGate({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  const s = I18N[store$.lang.get()];
  const locked = !!store$.settings.lock.get();
  const [unlocked, setUnlocked] = useState(false);

  const tryUnlock = useCallback(async () => {
    if (Platform.OS === 'web') {
      setUnlocked(true);
      return;
    }
    try {
      const has = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!has || !enrolled) {
        setUnlocked(true);
        return;
      }
      const res = await LocalAuthentication.authenticateAsync({ promptMessage: s.lockPrompt });
      if (res.success) setUnlocked(true);
    } catch {
      setUnlocked(true);
    }
  }, [s.lockPrompt]);

  useEffect(() => {
    if (locked && !unlocked) tryUnlock();
  }, [locked, unlocked, tryUnlock]);

  // Render the app always (keeps the router navigator mounted) and cover it
  // with an opaque overlay while locked.
  return (
    <View style={{ flex: 1 }}>
      {children}
      {locked && !unlocked && (
        <View style={[styles.overlay, { backgroundColor: t.paper }]}>
          <Flower size={64} center="yen" petal={t.hibiscus} stroke={t.hibiscusDeep} />
          <Text style={[styles.title, { color: t.ink }]}>{s.lockTitle}</Text>
          <Pressable style={[styles.btn, { backgroundColor: t.hibiscus }]} onPress={tryUnlock}>
            <Text style={styles.btnText}>{s.lockUnlock}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, elevation: 100, alignItems: 'center', justifyContent: 'center', gap: 18 },
  title: { fontSize: 18, fontWeight: '700' },
  btn: { borderRadius: 24, paddingVertical: 12, paddingHorizontal: 28 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
