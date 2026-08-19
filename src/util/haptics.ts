// Light tap feedback for selections (tab switches, etc.).
// Native-only: a no-op on web, and never throws if the module is unavailable.
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export function tapHaptic(): void {
  if (Platform.OS === 'web') return;
  try {
    Haptics.selectionAsync();
  } catch {
    // haptics unsupported on this device — ignore
  }
}
