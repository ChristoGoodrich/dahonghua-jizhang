// Daily local-notification reminder. expo-notifications is loaded lazily and
// guarded for web (where scheduled local notifications aren't supported), so the
// rest of the app never depends on it.
import { Platform } from 'react-native';

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(time: string): boolean {
  return HHMM.test(time.trim());
}

/** Schedule (replacing any existing) a daily reminder at HH:MM. Returns false if
 *  unsupported or permission denied. */
export async function scheduleDailyReminder(time: string, title: string, body: string): Promise<boolean> {
  if (Platform.OS === 'web' || !isValidTime(time)) return false;
  const Notifications: any = await import('expo-notifications');
  const perm = await Notifications.getPermissionsAsync();
  const granted = perm.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return false;
  await Notifications.cancelAllScheduledNotificationsAsync();
  const [h, m] = time.trim().split(':').map(Number);
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: { type: Notifications.SchedulableTriggerInputType.DAILY, hour: h, minute: m },
  });
  return true;
}

export async function cancelReminder(): Promise<void> {
  if (Platform.OS === 'web') return;
  const Notifications: any = await import('expo-notifications');
  await Notifications.cancelAllScheduledNotificationsAsync();
}
