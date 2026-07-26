// Daily local-notification reminder. expo-notifications is loaded lazily and
// guarded for web (where scheduled local notifications aren't supported), so the
// rest of the app never depends on it.
import { Platform } from 'react-native';

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Lazy-load expo-notifications. Returns null on web. */
async function loadNotifications(): Promise<any | null> {
  if (Platform.OS === 'web') return null;
  try {
    return require('expo-notifications');
  } catch {
    return null;
  }
}

export function isValidTime(time: string): boolean {
  return HHMM.test(time.trim());
}

/** Schedule (replacing any existing) a daily reminder at HH:MM. Returns false if
 *  unsupported or permission denied. */
export async function scheduleDailyReminder(time: string, title: string, body: string): Promise<boolean> {
  if (Platform.OS === 'web' || !isValidTime(time)) return false;
  const Notifications = await loadNotifications();
  if (!Notifications) return false;
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
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/** Send an immediate budget-warning notification. */
export async function scheduleBudgetWarning(percentage: number, remaining: string, lang: 'zh' | 'en' = 'zh'): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  const perm = await Notifications.getPermissionsAsync();
  const granted = perm.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return;
  const title = lang === 'zh' ? '预算预警' : 'Budget Warning';
  const body = lang === 'zh'
    ? `已使用 ${percentage}%，还剩 ${remaining}`
    : `${percentage}% used, ${remaining} left`;
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: null,
  });
}

/** Schedule a daily repeating reminder at the given hour:minute. */
export async function scheduleCustomReminder(hour: number, minute: number, lang: 'zh' | 'en' = 'zh'): Promise<boolean> {
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return false;
  const Notifications = await loadNotifications();
  if (!Notifications) return false;
  const perm = await Notifications.getPermissionsAsync();
  const granted = perm.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return false;
  await Notifications.cancelAllScheduledNotificationsAsync();
  const title = lang === 'zh' ? '记账提醒' : 'Reminder';
  const body = lang === 'zh' ? '别忘了记一笔哦 🌺' : "Don't forget to log an entry 🌺";
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: { type: Notifications.SchedulableTriggerInputType.DAILY, hour, minute },
  });
  return true;
}

/** Schedule a weekly spending summary every Sunday at 20:00. */
export async function scheduleWeeklyReport(lang: 'zh' | 'en' = 'zh'): Promise<boolean> {
  const Notifications = await loadNotifications();
  if (!Notifications) return false;
  const perm = await Notifications.getPermissionsAsync();
  const granted = perm.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return false;
  const title = lang === 'zh' ? '每周消费报告' : 'Weekly Spending Report';
  const body = lang === 'zh' ? '你的本周消费汇总已出炉，快来看看吧 🌺' : 'Your weekly spending summary is ready — take a look 🌺';
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: { type: Notifications.SchedulableTriggerInputType.WEEKLY, weekday: 1, hour: 20, minute: 0 },
  });
  return true;
}

/** Schedule a monthly spending summary on the 1st of each month at 09:00. */
export async function scheduleMonthlyReport(lang: 'zh' | 'en' = 'zh'): Promise<boolean> {
  const Notifications = await loadNotifications();
  if (!Notifications) return false;
  const perm = await Notifications.getPermissionsAsync();
  const granted = perm.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return false;
  const title = lang === 'zh' ? '每月消费报告' : 'Monthly Spending Report';
  const body = lang === 'zh' ? '上月消费汇总已生成，回顾一下吧 🌺' : 'Your monthly spending summary is ready — review it 🌺';
  // Compute next 1st at 09:00
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1, 9, 0, 0);
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: { type: Notifications.SchedulableTriggerInputType.DATE, date: next },
  });
  return true;
}
