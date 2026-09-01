//! Reminders: which ones are on, and when each fires.
//!
//! The times, the ids and the format of a time are the core's. Asking for
//! permission and handing a schedule to the operating system is Dart's, and so
//! is every word a notification says — a title and a body are locale strings.
//!
//! The ids matter more than they look. The shipping app cancels *all*
//! scheduled notifications before setting the daily reminder, so turning that
//! on silently wiped the weekly and monthly reports. Each schedule has its own
//! id here, so replacing one leaves the others alone.

use std::sync::{Mutex, MutexGuard, OnceLock};

use flutter_rust_bridge::frb;

use dahonghua_core::civil::Civil;
use dahonghua_core::remind::{daily, monthly, next_monthly_after, parse_time, weekly, Reminder};

/// What the user has switched on.
///
/// `#[frb(ignore)]` because this never crosses: the generator otherwise tries
/// to expose it, and a private type in a generated signature does not compile.
#[frb(ignore)]
#[derive(Debug, Clone, Default)]
struct Prefs {
    /// `HH:MM`, or empty for off.
    daily_at: String,
    weekly: bool,
    monthly: bool,
}

fn settings() -> MutexGuard<'static, Prefs> {
    static S: OnceLock<Mutex<Prefs>> = OnceLock::new();
    let m = S.get_or_init(|| Mutex::new(Prefs::default()));
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// One schedule for the platform to hand to the OS.
#[derive(Debug, Clone, PartialEq)]
pub struct ScheduleView {
    /// The id to schedule under, and to cancel by.
    pub id: i32,
    /// `daily`, `weekly` or `monthly`.
    pub kind: String,
    pub hour: u32,
    pub minute: u32,
    /// 1 = Sunday. Only meaningful for `weekly`.
    pub weekday: Option<u32>,
    /// Day of month. Only meaningful for `monthly`.
    pub day: Option<u32>,
}

/// Whether a string is a time this app will accept.
///
/// Exposed so a settings field can refuse before anything is stored, rather
/// than accepting text that quietly schedules nothing.
#[frb(sync)]
pub fn valid_time(text: String) -> bool {
    parse_time(&text).is_some()
}

/// Every reminder that is on, with when it fires. Empty when none are.
#[frb(sync)]
pub fn active_schedules() -> Vec<ScheduleView> {
    let s = settings();
    let mut out = Vec::new();
    if let Some((h, m)) = parse_time(&s.daily_at) {
        if let Some(d) = daily(h, m) {
            out.push(view(d));
        }
    }
    if s.weekly {
        out.push(view(weekly()));
    }
    if s.monthly {
        out.push(view(monthly()));
    }
    out
}

/// Every id this app ever schedules under.
///
/// The platform cancels these by id rather than cancelling everything: an app
/// is not the only thing that may have posted a notification, and "cancel all"
/// is a claim over other people's work.
#[frb(sync)]
pub fn all_ids() -> Vec<i32> {
    Reminder::ALL.iter().map(|r| r.id()).collect()
}

fn view(s: dahonghua_core::remind::Schedule) -> ScheduleView {
    ScheduleView {
        id: s.id,
        kind: s.kind.to_string(),
        hour: s.hour,
        minute: s.minute,
        weekday: s.weekday,
        day: s.day,
    }
}

/// Set the daily reminder's time. An empty or unparseable string turns it off.
#[frb(sync)]
pub fn set_daily_reminder(at: String) -> bool {
    let ok = parse_time(&at).is_some();
    settings().daily_at = if ok {
        at.trim().to_string()
    } else {
        String::new()
    };
    ok
}

#[frb(sync)]
pub fn daily_reminder_at() -> String {
    settings().daily_at.clone()
}

#[frb(sync)]
pub fn set_weekly_report(enabled: bool) {
    settings().weekly = enabled;
}

#[frb(sync)]
pub fn set_monthly_report(enabled: bool) {
    settings().monthly = enabled;
}

#[frb(sync)]
pub fn weekly_report_on() -> bool {
    settings().weekly
}

#[frb(sync)]
pub fn monthly_report_on() -> bool {
    settings().monthly
}

/// The next 1st of a month after `today`, as `y-m-d`.
///
/// For a platform that can only schedule a one-shot date rather than a
/// repeating monthly rule; it re-arms after each firing.
#[frb(sync)]
pub fn next_monthly_date(today: String) -> String {
    let mut it = today.split('-');
    let y = it.next().and_then(|v| v.parse().ok()).unwrap_or(1970);
    let m: i32 = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    let d = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    let next = next_monthly_after(Civil::new(y, m - 1, d));
    format!("{}-{}-{}", next.y, next.m + 1, next.d)
}

/// Restore from the config, without scheduling anything.
#[frb(sync)]
pub fn load_reminders(daily_at: String, weekly: bool, monthly: bool) {
    let mut s = settings();
    s.daily_at = if parse_time(&daily_at).is_some() {
        daily_at.trim().to_string()
    } else {
        String::new()
    };
    s.weekly = weekly;
    s.monthly = monthly;
}

/// Forget everything. For tests, which share one process.
#[frb(sync)]
pub fn reset_reminders() {
    *settings() = Prefs::default();
}
