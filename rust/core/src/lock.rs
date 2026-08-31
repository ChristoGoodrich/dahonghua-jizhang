//! The app lock, as a state machine.
//!
//! Ported from `src/components/LockGate.tsx`, whose every comment is a bug
//! somebody found. The component is 137 lines of which perhaps twenty draw
//! anything; the rest is *when to prompt, when to open without asking, when to
//! stay shut, and which answer belongs to which attempt*. That is the part that
//! lives here.
//!
//! What stays on the platform: whether the device has biometric hardware,
//! whether anything is enrolled, showing the prompt, and the lifecycle
//! callbacks. Each of those is reported back as an event and this decides what
//! it means.
//!
//! ## The rules, and what each one cost
//!
//! **An attempt has an id, and a stale one may not speak.** Android's
//! `BiometricPrompt` can be torn down by the OS without ever invoking its
//! callback, leaving the call pending forever. An attempt that does eventually
//! settle must not be able to unlock the app, and must not clear a newer
//! attempt's in-flight flag.
//!
//! **Pressing unlock supersedes an attempt already in flight.** Bailing out
//! instead was the first spelling, and a hung prompt latched the flag on
//! forever: every later tap returned early and did nothing, so the button was
//! dead with no feedback until the process restarted.
//!
//! **An error leaves the gate shut.** The first version unlocked. An exception
//! means authentication could not be performed — the one case where staying
//! locked matters most — and some Android devices throw after repeated failed
//! attempts, which turned the lock into a formality.
//!
//! **No hardware and nothing enrolled means open.** There is nothing to check
//! against, and gating on it would lock a user out of their own ledger.
//!
//! **Only a real trip through the background supersedes.** iOS reports
//! `inactive` then `active` around its own auth dialog, so restarting on every
//! resume would prompt twice over the top of itself.

/// What the device said when asked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthOutcome {
    /// The user proved who they are.
    Success,
    /// A wrong finger, or a cancel. Deliberate, and answerable by trying again.
    Rejected,
    /// Authentication could not be performed at all.
    Errored,
}

/// What the gate is telling the user, if anything.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LockNotice {
    /// It did not accept you. A silent no-op reads as a broken button.
    Failed,
    /// It could not ask. Different from a refusal, and worth saying so.
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LockEvent {
    /// The gate appeared.
    Mounted,
    /// The setting was turned on or off.
    LockChanged(bool),
    /// The app came back to the foreground.
    Resumed,
    /// The app really left — the app switcher, another app, the home screen.
    Backgrounded,
    /// The app is briefly not frontmost. On iOS this is what the system's own
    /// auth dialog reports, so it is **not** a trip through the background.
    Inactive,
    /// The user pressed the button on the gate.
    UnlockPressed,
    /// What the device can do, in answer to a [`LockEffect::RunAuth`].
    Capability {
        attempt: u64,
        has_hardware: bool,
        enrolled: bool,
    },
    /// How the prompt ended.
    AuthSettled { attempt: u64, outcome: AuthOutcome },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LockEffect {
    /// Ask the device: hardware, enrolment, then the prompt. Report back with
    /// this `attempt`, whatever happens.
    RunAuth { attempt: u64 },
    /// Tear down a prompt that is still up. Android only; elsewhere it is a
    /// no-op and the superseded attempt is ignored by its id anyway.
    CancelAuth,
    /// Let the app through.
    Unlock,
    /// Close the gate again.
    Relock,
    /// Say something, or stop saying it.
    Notice(Option<LockNotice>),
}

/// Every field's zero is its correct start: no lock, shut, nothing said,
/// nothing in flight, attempt zero — which no answer can ever carry, so a
/// reply that arrives before anything was asked is stale by construction.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Lock {
    /// The setting. False means there is no gate at all.
    pub enabled: bool,
    /// Whether the gate is currently open.
    pub unlocked: bool,
    /// What the gate is saying.
    pub notice: Option<LockNotice>,
    /// A prompt is up.
    authing: bool,
    /// Monotonic. The only thing that makes a stale answer identifiable.
    attempt: u64,
    /// The app really went away, so an in-flight prompt is worth superseding.
    was_backgrounded: bool,
}

impl Lock {
    pub fn new(enabled: bool) -> Self {
        Lock {
            enabled,
            ..Default::default()
        }
    }

    /// Whether the app's content should be covered right now.
    pub fn gated(&self) -> bool {
        self.enabled && !self.unlocked
    }

    /// Which attempt is current. An answer carrying anything else is stale.
    pub fn attempt(&self) -> u64 {
        self.attempt
    }

    pub fn authing(&self) -> bool {
        self.authing
    }

    fn start(&mut self, restart: bool) -> Vec<LockEffect> {
        if self.authing && !restart {
            // A prompt is already up and this is not a deliberate retry.
            return Vec::new();
        }
        let mut out = Vec::new();
        if self.authing {
            out.push(LockEffect::CancelAuth);
        }
        self.attempt += 1;
        self.authing = true;
        if self.notice.is_some() {
            self.notice = None;
            out.push(LockEffect::Notice(None));
        }
        out.push(LockEffect::RunAuth {
            attempt: self.attempt,
        });
        out
    }

    fn open(&mut self) -> Vec<LockEffect> {
        self.authing = false;
        self.unlocked = true;
        vec![LockEffect::Unlock]
    }

    fn say(&mut self, n: LockNotice) -> Vec<LockEffect> {
        self.authing = false;
        self.notice = Some(n);
        vec![LockEffect::Notice(Some(n))]
    }

    /// Take one event and say what should happen.
    pub fn step(&mut self, ev: LockEvent) -> Vec<LockEffect> {
        match ev {
            // Keyed on the lock being on rather than on being locked. Keying it
            // the other way spent the one automatic attempt at the moment the
            // app was leaving the foreground, because re-locking flips
            // `unlocked` and would have re-triggered this.
            LockEvent::Mounted => {
                if self.gated() {
                    self.start(false)
                } else {
                    Vec::new()
                }
            }

            LockEvent::LockChanged(on) => {
                self.enabled = on;
                if on && !self.unlocked {
                    self.start(false)
                } else {
                    Vec::new()
                }
            }

            LockEvent::UnlockPressed => self.start(true),

            LockEvent::Resumed => {
                if !self.enabled {
                    return Vec::new();
                }
                let stale = self.was_backgrounded;
                self.was_backgrounded = false;
                if self.unlocked {
                    Vec::new()
                } else {
                    self.start(stale)
                }
            }

            // The gate closes behind you. Without this it was launch-only: one
            // unlock held for the life of the process, so anyone picking the
            // phone up out of the app switcher walked straight in.
            LockEvent::Backgrounded => {
                self.was_backgrounded = true;
                self.relock_unless_authing()
            }

            LockEvent::Inactive => self.relock_unless_authing(),

            LockEvent::Capability {
                attempt,
                has_hardware,
                enrolled,
            } => {
                if attempt != self.attempt {
                    return Vec::new();
                }
                if has_hardware && enrolled {
                    // Capable. The prompt is the platform's next move; nothing
                    // to decide until it settles.
                    Vec::new()
                } else {
                    self.open()
                }
            }

            LockEvent::AuthSettled { attempt, outcome } => {
                if attempt != self.attempt {
                    return Vec::new();
                }
                match outcome {
                    AuthOutcome::Success => self.open(),
                    AuthOutcome::Rejected => self.say(LockNotice::Failed),
                    AuthOutcome::Errored => self.say(LockNotice::Unavailable),
                }
            }
        }
    }

    /// Close the gate, unless a prompt is up — the system's own dialog takes
    /// the app out of the foreground, and re-locking under it would fight it.
    fn relock_unless_authing(&mut self) -> Vec<LockEffect> {
        if self.authing || !self.enabled || !self.unlocked {
            return Vec::new();
        }
        self.unlocked = false;
        vec![LockEffect::Relock]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn on() -> Lock {
        Lock::new(true)
    }

    /// Drive a whole successful unlock, the way the platform would.
    fn unlock(l: &mut Lock) {
        let id = l.attempt();
        l.step(LockEvent::Capability {
            attempt: id,
            has_hardware: true,
            enrolled: true,
        });
        l.step(LockEvent::AuthSettled {
            attempt: id,
            outcome: AuthOutcome::Success,
        });
    }

    #[test]
    fn a_lock_that_is_off_is_not_a_gate() {
        let mut l = Lock::new(false);
        assert_eq!(l.step(LockEvent::Mounted), vec![]);
        assert!(!l.gated());
    }

    #[test]
    fn mounting_with_the_lock_on_asks_once() {
        let mut l = on();
        assert_eq!(
            l.step(LockEvent::Mounted),
            vec![LockEffect::RunAuth { attempt: 1 }]
        );
        assert!(l.gated());
    }

    #[test]
    fn turning_the_lock_on_asks_straight_away() {
        let mut l = Lock::new(false);
        assert_eq!(
            l.step(LockEvent::LockChanged(true)),
            vec![LockEffect::RunAuth { attempt: 1 }]
        );
    }

    #[test]
    fn a_device_with_nothing_enrolled_opens_rather_than_locking_you_out() {
        let mut l = on();
        l.step(LockEvent::Mounted);
        assert_eq!(
            l.step(LockEvent::Capability {
                attempt: 1,
                has_hardware: false,
                enrolled: false,
            }),
            vec![LockEffect::Unlock]
        );
        assert!(!l.gated());
    }

    #[test]
    fn hardware_without_enrolment_opens_too() {
        let mut l = on();
        l.step(LockEvent::Mounted);
        assert_eq!(
            l.step(LockEvent::Capability {
                attempt: 1,
                has_hardware: true,
                enrolled: false,
            }),
            vec![LockEffect::Unlock]
        );
    }

    #[test]
    fn a_capable_device_says_nothing_until_the_prompt_settles() {
        let mut l = on();
        l.step(LockEvent::Mounted);
        assert_eq!(
            l.step(LockEvent::Capability {
                attempt: 1,
                has_hardware: true,
                enrolled: true,
            }),
            vec![]
        );
        assert!(l.gated());
    }

    #[test]
    fn success_opens_the_gate() {
        let mut l = on();
        l.step(LockEvent::Mounted);
        unlock(&mut l);
        assert!(!l.gated());
        assert!(!l.authing());
    }

    #[test]
    fn a_refusal_says_so_rather_than_doing_nothing() {
        let mut l = on();
        l.step(LockEvent::Mounted);
        assert_eq!(
            l.step(LockEvent::AuthSettled {
                attempt: 1,
                outcome: AuthOutcome::Rejected,
            }),
            vec![LockEffect::Notice(Some(LockNotice::Failed))]
        );
        assert!(l.gated(), "a refusal leaves the gate shut");
    }

    /// The one that used to unlock. Some Android devices throw after repeated
    /// failures, which turned the lock into a formality.
    #[test]
    fn an_error_leaves_the_gate_shut() {
        let mut l = on();
        l.step(LockEvent::Mounted);
        assert_eq!(
            l.step(LockEvent::AuthSettled {
                attempt: 1,
                outcome: AuthOutcome::Errored,
            }),
            vec![LockEffect::Notice(Some(LockNotice::Unavailable))]
        );
        assert!(l.gated());
    }

    #[test]
    fn a_second_ask_while_one_is_up_is_ignored() {
        let mut l = on();
        l.step(LockEvent::Mounted);
        // Not a deliberate retry: mounting again changes nothing.
        assert_eq!(l.step(LockEvent::Mounted), vec![]);
        assert_eq!(l.attempt(), 1);
    }

    /// The dead button. Bailing out here left a hung prompt latched on forever.
    #[test]
    fn pressing_unlock_supersedes_a_prompt_that_is_still_up() {
        let mut l = on();
        l.step(LockEvent::Mounted);
        assert_eq!(
            l.step(LockEvent::UnlockPressed),
            vec![LockEffect::CancelAuth, LockEffect::RunAuth { attempt: 2 }]
        );
    }

    #[test]
    fn pressing_unlock_clears_what_the_last_attempt_said() {
        let mut l = on();
        l.step(LockEvent::Mounted);
        l.step(LockEvent::AuthSettled {
            attempt: 1,
            outcome: AuthOutcome::Rejected,
        });
        assert_eq!(
            l.step(LockEvent::UnlockPressed),
            vec![LockEffect::Notice(None), LockEffect::RunAuth { attempt: 2 }]
        );
        assert_eq!(l.notice, None);
    }

    /// The whole reason attempts are numbered.
    #[test]
    fn a_stale_success_cannot_open_the_gate() {
        let mut l = on();
        l.step(LockEvent::Mounted); // attempt 1
        l.step(LockEvent::UnlockPressed); // attempt 2 supersedes it

        assert_eq!(
            l.step(LockEvent::AuthSettled {
                attempt: 1,
                outcome: AuthOutcome::Success,
            }),
            vec![]
        );
        assert!(l.gated(), "an abandoned prompt must not let anyone in");
        assert!(l.authing(), "nor clear the live attempt's flag");
    }

    #[test]
    fn a_stale_capability_answer_is_ignored_too() {
        let mut l = on();
        l.step(LockEvent::Mounted);
        l.step(LockEvent::UnlockPressed);
        assert_eq!(
            l.step(LockEvent::Capability {
                attempt: 1,
                has_hardware: false,
                enrolled: false,
            }),
            vec![]
        );
        assert!(l.gated());
    }

    /// Without this the gate was launch-only.
    #[test]
    fn leaving_the_app_closes_the_gate_again() {
        let mut l = on();
        l.step(LockEvent::Mounted);
        unlock(&mut l);
        assert_eq!(l.step(LockEvent::Backgrounded), vec![LockEffect::Relock]);
        assert!(l.gated());
    }

    #[test]
    fn going_inactive_under_our_own_prompt_does_not_relock() {
        let mut l = on();
        l.step(LockEvent::Mounted);
        unlock(&mut l);
        l.step(LockEvent::UnlockPressed); // a prompt is up again
        assert_eq!(l.step(LockEvent::Inactive), vec![]);
        assert!(!l.gated(), "the system dialog is not a departure");
    }

    #[test]
    fn coming_back_after_a_real_departure_supersedes_the_old_prompt() {
        let mut l = on();
        l.step(LockEvent::Mounted); // attempt 1, prompt up
        l.step(LockEvent::Backgrounded);
        assert_eq!(
            l.step(LockEvent::Resumed),
            vec![LockEffect::CancelAuth, LockEffect::RunAuth { attempt: 2 }]
        );
    }

    /// iOS reports inactive/active around its own dialog. Restarting on every
    /// resume would prompt twice over the top of itself.
    #[test]
    fn coming_back_without_having_left_does_not_supersede() {
        let mut l = on();
        l.step(LockEvent::Mounted); // attempt 1, prompt up
        assert_eq!(
            l.step(LockEvent::Resumed),
            vec![],
            "no trip through the background, so the live prompt stands"
        );
        assert_eq!(l.attempt(), 1);
    }

    #[test]
    fn resuming_while_already_open_asks_nothing() {
        let mut l = on();
        l.step(LockEvent::Mounted);
        unlock(&mut l);
        assert_eq!(l.step(LockEvent::Resumed), vec![]);
    }

    #[test]
    fn resuming_with_the_lock_off_asks_nothing() {
        let mut l = Lock::new(false);
        assert_eq!(l.step(LockEvent::Resumed), vec![]);
    }

    #[test]
    fn the_departure_flag_is_spent_once() {
        let mut l = on();
        l.step(LockEvent::Mounted);
        l.step(LockEvent::Backgrounded);
        l.step(LockEvent::Resumed); // consumes it, attempt 2
        assert_eq!(
            l.step(LockEvent::Resumed),
            vec![],
            "a second resume without leaving does not restart"
        );
        assert_eq!(l.attempt(), 2);
    }

    #[test]
    fn turning_the_lock_off_leaves_the_gate_open() {
        let mut l = on();
        l.step(LockEvent::Mounted);
        assert_eq!(l.step(LockEvent::LockChanged(false)), vec![]);
        assert!(!l.gated());
    }

    #[test]
    fn turning_it_on_again_when_already_unlocked_asks_nothing() {
        let mut l = on();
        l.step(LockEvent::Mounted);
        unlock(&mut l);
        l.step(LockEvent::LockChanged(false));
        assert_eq!(l.step(LockEvent::LockChanged(true)), vec![]);
    }

    #[test]
    fn a_refusal_then_a_retry_that_succeeds_opens_the_gate() {
        let mut l = on();
        l.step(LockEvent::Mounted);
        l.step(LockEvent::AuthSettled {
            attempt: 1,
            outcome: AuthOutcome::Rejected,
        });
        l.step(LockEvent::UnlockPressed);
        unlock(&mut l);
        assert!(!l.gated());
        assert_eq!(l.notice, None);
    }

    #[test]
    fn backgrounding_while_locked_changes_nothing_but_the_flag() {
        let mut l = on();
        l.step(LockEvent::Mounted);
        assert_eq!(l.step(LockEvent::Backgrounded), vec![]);
        // ...but the flag is set, so the next resume supersedes.
        assert_eq!(
            l.step(LockEvent::Resumed),
            vec![LockEffect::CancelAuth, LockEffect::RunAuth { attempt: 2 }]
        );
    }
}
