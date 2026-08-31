//! The app lock's decisions.
//!
//! Every rule about *when* to prompt, when to open without asking, when to stay
//! shut, and which answer belongs to which attempt is in the core's `lock`
//! module. This holds the state and converts the events across.
//!
//! What Dart does: ask the device whether it has biometric hardware and
//! whether anything is enrolled, show the prompt, and report the lifecycle. It
//! decides none of it — which matters most for the rule that an *error* leaves
//! the gate shut, because the obvious platform-side reflex is to let the user
//! in when the check cannot be run.

use std::sync::{Mutex, MutexGuard, OnceLock};

use flutter_rust_bridge::frb;

use dahonghua_core::lock::{AuthOutcome, Lock, LockEffect, LockEvent, LockNotice};

fn lock() -> MutexGuard<'static, Lock> {
    static L: OnceLock<Mutex<Lock>> = OnceLock::new();
    let m = L.get_or_init(|| Mutex::new(Lock::default()));
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// One thing for the platform to do.
#[derive(Debug, Clone, PartialEq)]
pub struct LockAction {
    /// `runAuth`, `cancelAuth`, `unlock`, `relock` or `notice`.
    pub kind: String,
    /// Which attempt a `runAuth` belongs to. Every answer must carry it back,
    /// or the core cannot tell a live prompt from an abandoned one.
    pub attempt: u64,
    /// For `notice`: `failed`, `unavailable`, or absent to stop saying
    /// anything.
    pub notice: Option<String>,
}

fn out(effects: Vec<LockEffect>) -> Vec<LockAction> {
    effects
        .into_iter()
        .map(|e| match e {
            LockEffect::RunAuth { attempt } => LockAction {
                kind: "runAuth".into(),
                attempt,
                notice: None,
            },
            LockEffect::CancelAuth => LockAction {
                kind: "cancelAuth".into(),
                attempt: 0,
                notice: None,
            },
            LockEffect::Unlock => LockAction {
                kind: "unlock".into(),
                attempt: 0,
                notice: None,
            },
            LockEffect::Relock => LockAction {
                kind: "relock".into(),
                attempt: 0,
                notice: None,
            },
            LockEffect::Notice(n) => LockAction {
                kind: "notice".into(),
                attempt: 0,
                notice: n.map(|n| {
                    match n {
                        LockNotice::Failed => "failed",
                        LockNotice::Unavailable => "unavailable",
                    }
                    .to_string()
                }),
            },
        })
        .collect()
}

/// The gate appeared.
#[frb(sync)]
pub fn lock_mounted() -> Vec<LockAction> {
    out(lock().step(LockEvent::Mounted))
}

/// The setting was turned on or off.
#[frb(sync)]
pub fn lock_set_enabled(enabled: bool) -> Vec<LockAction> {
    out(lock().step(LockEvent::LockChanged(enabled)))
}

/// The app came back to the foreground.
#[frb(sync)]
pub fn lock_resumed() -> Vec<LockAction> {
    out(lock().step(LockEvent::Resumed))
}

/// The app really left. Distinct from [`lock_inactive`], and the difference
/// decides whether a prompt still up is worth superseding.
#[frb(sync)]
pub fn lock_backgrounded() -> Vec<LockAction> {
    out(lock().step(LockEvent::Backgrounded))
}

/// The app is briefly not frontmost — which is what the system's own auth
/// dialog looks like from here.
#[frb(sync)]
pub fn lock_inactive() -> Vec<LockAction> {
    out(lock().step(LockEvent::Inactive))
}

/// The user pressed the button on the gate.
#[frb(sync)]
pub fn lock_unlock_pressed() -> Vec<LockAction> {
    out(lock().step(LockEvent::UnlockPressed))
}

/// What the device can do. Carry back the `attempt` from the `runAuth`.
#[frb(sync)]
pub fn lock_capability(attempt: u64, has_hardware: bool, enrolled: bool) -> Vec<LockAction> {
    out(lock().step(LockEvent::Capability {
        attempt,
        has_hardware,
        enrolled,
    }))
}

/// How the prompt ended. `outcome` is `success`, `rejected` or `errored`.
///
/// The three are not interchangeable: a rejection is a wrong finger and a
/// retry may work, while an error means the question could not be asked.
#[frb(sync)]
pub fn lock_settled(attempt: u64, outcome: String) -> Vec<LockAction> {
    let outcome = match outcome.as_str() {
        "success" => AuthOutcome::Success,
        "rejected" => AuthOutcome::Rejected,
        // Anything unrecognised is an error, which is the safe side: it leaves
        // the gate shut rather than opening it on a value nobody meant.
        _ => AuthOutcome::Errored,
    };
    out(lock().step(LockEvent::AuthSettled { attempt, outcome }))
}

/// Whether the app's content should be covered right now.
#[frb(sync)]
pub fn lock_gated() -> bool {
    lock().gated()
}

/// Whether the setting is on.
#[frb(sync)]
pub fn lock_enabled() -> bool {
    lock().enabled
}

/// What the gate is saying, if anything.
#[frb(sync)]
pub fn lock_notice() -> Option<String> {
    lock().notice.map(|n| {
        match n {
            LockNotice::Failed => "failed",
            LockNotice::Unavailable => "unavailable",
        }
        .to_string()
    })
}

/// Restore the setting from the config, without prompting.
///
/// Separate from [`lock_set_enabled`] on purpose: loading a config is not a
/// user turning the lock on, and prompting during a file read would ask before
/// there is a screen to ask on top of.
#[frb(sync)]
pub fn lock_load(enabled: bool) {
    let mut l = lock();
    l.enabled = enabled;
}

/// Forget everything. For tests, which share one process.
#[frb(sync)]
pub fn lock_reset() {
    *lock() = Lock::default();
}
