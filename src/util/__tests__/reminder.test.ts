import { isValidTime, scheduleBudgetWarning, scheduleCustomReminder, scheduleWeeklyReport, scheduleMonthlyReport, scheduleDailyReminder, cancelReminder } from '../reminder';
import { Platform } from 'react-native';

const mockSchedule = jest.fn();
const mockCancel = jest.fn();
const mockGetPerms = jest.fn().mockResolvedValue({ granted: true });
const mockRequestPerms = jest.fn().mockResolvedValue({ granted: true });

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: (...a: any[]) => mockGetPerms(...a),
  requestPermissionsAsync: (...a: any[]) => mockRequestPerms(...a),
  scheduleNotificationAsync: (...a: any[]) => mockSchedule(...a),
  cancelAllScheduledNotificationsAsync: (...a: any[]) => mockCancel(...a),
  SchedulableTriggerInputTypes: { DAILY: 'daily', WEEKLY: 'weekly', DATE: 'date' },
}));

beforeEach(() => {
  jest.clearAllMocks();
  (Platform as any).OS = 'ios';
});

describe('isValidTime', () => {
  it('accepts valid 24h HH:MM', () => {
    ['0:00', '00:00', '9:05', '09:05', '21:30', '23:59'].forEach((t) => expect(isValidTime(t)).toBe(true));
  });
  it('trims surrounding whitespace', () => {
    expect(isValidTime('  21:30 ')).toBe(true);
  });
  it('rejects malformed or out-of-range times', () => {
    ['24:00', '12:60', '9', '9:5', 'abc', '', '99:99'].forEach((t) => expect(isValidTime(t)).toBe(false));
  });
});

describe('scheduleBudgetWarning', () => {
  it('sends immediate notification with zh text', async () => {
    await scheduleBudgetWarning(80, '¥200', 'zh');
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const arg = mockSchedule.mock.calls[0][0];
    expect(arg.content.title).toBe('预算预警');
    expect(arg.content.body).toContain('80%');
    expect(arg.content.body).toContain('¥200');
    expect(arg.trigger).toBeNull();
  });

  it('sends immediate notification with en text', async () => {
    await scheduleBudgetWarning(90, '$50', 'en');
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const arg = mockSchedule.mock.calls[0][0];
    expect(arg.content.title).toBe('Budget Warning');
    expect(arg.content.body).toContain('90%');
    expect(arg.content.body).toContain('$50');
  });

  it('defaults to zh when lang omitted', async () => {
    await scheduleBudgetWarning(75, '¥100');
    const arg = mockSchedule.mock.calls[0][0];
    expect(arg.content.title).toBe('预算预警');
  });

  it('is a no-op on web', async () => {
    (Platform as any).OS = 'web';
    await scheduleBudgetWarning(80, '¥200');
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('does nothing when permission denied', async () => {
    mockGetPerms.mockResolvedValueOnce({ granted: false });
    mockRequestPerms.mockResolvedValueOnce({ granted: false });
    await scheduleBudgetWarning(80, '¥200');
    expect(mockSchedule).not.toHaveBeenCalled();
  });
});

describe('scheduleCustomReminder', () => {
  it('schedules a daily notification at given time', async () => {
    const result = await scheduleCustomReminder(9, 30);
    expect(result).toBe(true);
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const arg = mockSchedule.mock.calls[0][0];
    expect(arg.trigger).toEqual({ type: 'daily', hour: 9, minute: 30 });
    expect(arg.content.title).toBe('记账提醒');
    expect(arg.content.body).toContain('🌺');
  });

  it('uses en text when lang is en', async () => {
    await scheduleCustomReminder(8, 0, 'en');
    const arg = mockSchedule.mock.calls[0][0];
    expect(arg.content.title).toBe('Reminder');
    expect(arg.content.body).toContain("Don't forget");
  });

  it('returns false for invalid hour', async () => {
    expect(await scheduleCustomReminder(25, 0)).toBe(false);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('returns false for invalid minute', async () => {
    expect(await scheduleCustomReminder(12, 60)).toBe(false);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('is a no-op on web', async () => {
    (Platform as any).OS = 'web';
    expect(await scheduleCustomReminder(9, 0)).toBe(false);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('returns false when permission denied', async () => {
    mockGetPerms.mockResolvedValueOnce({ granted: false });
    mockRequestPerms.mockResolvedValueOnce({ granted: false });
    expect(await scheduleCustomReminder(9, 0)).toBe(false);
    expect(mockSchedule).not.toHaveBeenCalled();
  });
});

describe('scheduleWeeklyReport', () => {
  it('schedules a weekly Sunday 20:00 notification with zh text', async () => {
    const result = await scheduleWeeklyReport('zh');
    expect(result).toBe(true);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const arg = mockSchedule.mock.calls[0][0];
    expect(arg.trigger).toEqual({ type: 'weekly', weekday: 1, hour: 20, minute: 0 });
    expect(arg.content.title).toBe('每周消费报告');
  });

  it('schedules with en text', async () => {
    await scheduleWeeklyReport('en');
    const arg = mockSchedule.mock.calls[0][0];
    expect(arg.content.title).toBe('Weekly Spending Report');
  });

  it('defaults to zh when lang omitted', async () => {
    await scheduleWeeklyReport();
    const arg = mockSchedule.mock.calls[0][0];
    expect(arg.content.title).toBe('每周消费报告');
  });

  it('is a no-op on web', async () => {
    (Platform as any).OS = 'web';
    expect(await scheduleWeeklyReport('zh')).toBe(false);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('returns false when permission denied', async () => {
    mockGetPerms.mockResolvedValueOnce({ granted: false });
    mockRequestPerms.mockResolvedValueOnce({ granted: false });
    expect(await scheduleWeeklyReport('zh')).toBe(false);
    expect(mockSchedule).not.toHaveBeenCalled();
  });
});

describe('scheduleMonthlyReport', () => {
  it('schedules a monthly notification on the 1st at 09:00 with zh text', async () => {
    const result = await scheduleMonthlyReport('zh');
    expect(result).toBe(true);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const arg = mockSchedule.mock.calls[0][0];
    expect(arg.trigger.type).toBe('date');
    expect(arg.trigger.date).toBeInstanceOf(Date);
    expect(arg.trigger.date.getHours()).toBe(9);
    expect(arg.trigger.date.getMinutes()).toBe(0);
    expect(arg.trigger.date.getDate()).toBe(1);
    expect(arg.content.title).toBe('每月消费报告');
  });

  it('schedules with en text', async () => {
    await scheduleMonthlyReport('en');
    const arg = mockSchedule.mock.calls[0][0];
    expect(arg.content.title).toBe('Monthly Spending Report');
  });

  it('defaults to zh when lang omitted', async () => {
    await scheduleMonthlyReport();
    const arg = mockSchedule.mock.calls[0][0];
    expect(arg.content.title).toBe('每月消费报告');
  });

  it('is a no-op on web', async () => {
    (Platform as any).OS = 'web';
    expect(await scheduleMonthlyReport('zh')).toBe(false);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('returns false when permission denied', async () => {
    mockGetPerms.mockResolvedValueOnce({ granted: false });
    mockRequestPerms.mockResolvedValueOnce({ granted: false });
    expect(await scheduleMonthlyReport('zh')).toBe(false);
    expect(mockSchedule).not.toHaveBeenCalled();
  });
});

describe('scheduleDailyReminder', () => {
  it('schedules a daily notification at valid time', async () => {
    const result = await scheduleDailyReminder('09:30', '提醒', '别忘了记账');
    expect(result).toBe(true);
    expect(mockCancel).toHaveBeenCalled();
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const arg = mockSchedule.mock.calls[0][0];
    expect(arg.trigger).toEqual({ type: 'daily', hour: 9, minute: 30 });
    expect(arg.content.title).toBe('提醒');
    expect(arg.content.body).toBe('别忘了记账');
  });

  it('returns false for invalid time format', async () => {
    expect(await scheduleDailyReminder('25:00', 't', 'b')).toBe(false);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('returns false on web', async () => {
    (Platform as any).OS = 'web';
    expect(await scheduleDailyReminder('09:00', 't', 'b')).toBe(false);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('returns false when permission denied', async () => {
    mockGetPerms.mockResolvedValueOnce({ granted: false });
    mockRequestPerms.mockResolvedValueOnce({ granted: false });
    expect(await scheduleDailyReminder('09:00', 't', 'b')).toBe(false);
    expect(mockSchedule).not.toHaveBeenCalled();
  });
});

describe('cancelReminder', () => {
  it('cancels all scheduled notifications', async () => {
    await cancelReminder();
    expect(mockCancel).toHaveBeenCalledTimes(1);
  });

  it('is a no-op on web', async () => {
    (Platform as any).OS = 'web';
    await cancelReminder();
    expect(mockCancel).not.toHaveBeenCalled();
  });
});
