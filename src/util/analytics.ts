import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'dhh_analytics';
const MAX_EVENTS = 1000;

export interface AnalyticsEvent {
  name: string;
  properties?: Record<string, unknown>;
  timestamp: number;
}

let events: AnalyticsEvent[] = [];
let loaded = false;

export async function loadAnalytics(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      events = JSON.parse(raw) as AnalyticsEvent[];
    }
    loaded = true;
  } catch {
    events = [];
    loaded = true;
  }
}

export function trackEvent(name: string, properties?: Record<string, unknown>): void {
  if (!loaded) return;
  const event: AnalyticsEvent = { name, timestamp: Date.now() };
  if (properties) event.properties = properties;
  events.push(event);
  if (events.length > MAX_EVENTS) {
    events = events.slice(events.length - MAX_EVENTS);
  }
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(events)).catch(() => {});
}

export function getEvents(): AnalyticsEvent[] {
  return [...events];
}

export async function clearEvents(): Promise<void> {
  events = [];
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export const AnalyticsEvents = {
  ENTRY_CREATED: 'entry_created',
  ENTRY_DELETED: 'entry_deleted',
  BUDGET_SET: 'budget_set',
  REPORT_GENERATED: 'report_generated',
  THEME_CHANGED: 'theme_changed',
  FEEDBACK_SUBMITTED: 'feedback_submitted',
} as const;
