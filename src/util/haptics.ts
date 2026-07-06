// Light tap feedback for selections (tab switches, etc.).
// Native-only: a no-op on web, and never throws if the module is unavailable.
import { Platform } from 'react-native';

let mod: typeof import('expo-haptics') | null = null;

export function tapHaptic(): void {
  if (Platform.OS === 'web') return;
  try {
    if (!mod) mod = require('expo-haptics') as typeof import('expo-haptics');
    mod?.selectionAsync();
  } catch {
    // haptics unsupported on this device — ignore
  }
}
