//! The sync engine's orchestration, with the network left on the platform.
//!
//! Ported from `sync/engine.ts`. That file is 310 lines of which perhaps forty
//! are decisions; the rest is Supabase. The forty are what is here, and they
//! are the forty that have been wrong before: the realtime path that discarded
//! field-level merges, the config read whose failure looked like "no config
//! yet", the config push whose error was swallowed so a failed upload counted
//! as a success.
//!
//! The shape is a state machine over [`Event`] returning [`Effect`]s. Nothing
//! here performs I/O, reads a clock, or knows what Supabase is — the platform
//! performs the effects and reports back what happened. That is the same split
//! the rest of the crate uses, applied to a module whose *whole* subject is
//! I/O: what survives the split is the order things happen in, what a failure
//! at each step means, and which state may advance on which outcome.
//!
//! Rows cross as [`Value`], not `Entry`, because [`crate::merge`] resolves them
//! field by field over whatever keys a row actually carries — a typed struct
//! would decide in advance which fields can be merged, and the shipping merge
//! does not.
//!
//! Three obligations on the caller, none of which this module can enforce:
//!
//! * **[`Event::SignIn`] means the local data is already loaded.** The
//!   TypeScript awaits `whenDataReady()`, the section stamps and the conflict
//!   log before its first pull, because merging against a partial ledger bumps
//!   the push watermark past history that was never uploaded — which would
//!   then never sync at all.
//! * **Writes made for [`Effect::ApplyConfig`] must not come back as
//!   [`Event::LocalEdit`].** The TypeScript guards this with `applyingRemote`;
//!   here the caller simply does not report its own echo. Reporting it would
//!   re-stamp the section as a local edit and push it straight back, which is
//!   two devices bouncing one blob off each other forever.
//! * **The clock is the platform's**, as everywhere else. Every event that
//!   needs a time carries one.

use crate::jsval::Value;
use crate::merge::{merge_by_id, merge_one, updated_at, Conflict};
use crate::sync::{
    advance_by, bump_by, dirty_since_by, next_delay, Stamps, DEBOUNCE_MS, RETRY_BASE_MS,
    RETRY_MAX_MS,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Status {
    #[default]
    Off,
    Syncing,
    Synced,
    Error,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Off => "off",
            Status::Syncing => "syncing",
            Status::Synced => "synced",
            Status::Error => "error",
        }
    }
}

/// The two timers the scheduler owns. Setting one replaces it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Timer {
    /// Coalesces a burst of local changes into one upload.
    Debounce,
    /// Exponential backoff after a failed upload.
    Retry,
}

/// Entries and config live in different tables and need different channels —
/// the entries channel never carries a config change, which is why a device
/// only saw another device's account edits after a restart.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    Entries,
    Config,
}

/// How far a flush got. The distinction is not pedantic: the watermark advances
/// past rows that were persisted even when the config push after them fails, so
/// a retry does not re-upload rows the server already has.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FlushOutcome {
    /// Neither half landed. The watermark does not move.
    EntriesFailed,
    /// The rows landed, the config did not.
    ConfigFailed,
    Ok,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Effect {
    PullEntries,
    PullConfig,
    /// Upsert these rows, then report [`Event::PulledPushDone`]. This is the
    /// pull's own push of what the server was missing, not the scheduler's —
    /// it happens inside start-up and its failure aborts the sign-in.
    PushPulled(Vec<Value>),
    /// Upload the config blob, then report [`Event::ConfigPushDone`]. Also
    /// start-up only.
    PushConfig,
    /// Upsert these rows and then the config, reporting one [`FlushOutcome`].
    /// The rows may be empty — the config is pushed either way, which is what
    /// makes an accounts-only change reach the cloud.
    Flush(Vec<Value>),
    Subscribe(Channel),
    Unsubscribe(Channel),
    /// Replace any pending timer of this kind.
    SetTimer(Timer, i64),
    ClearTimer(Timer),
    Status(Status),
    /// An upload succeeded; the platform stamps it with its own clock.
    LastSync,
    /// Write these sections of the remote blob into the store, in
    /// [`crate::sync::CONFIG_SECTIONS`] order. **Not** to be reported back as a
    /// local edit.
    ApplyConfig(Vec<String>),
    /// The merged ledger.
    SetEntries(Vec<Value>),
    /// Resolutions worth recording, in the order the merge produced them.
    LogConflicts(Vec<Conflict>),
    /// The section stamps changed and should be persisted.
    SaveStamps,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    /// A session appeared. The local ledger, stamps and conflict log are
    /// already loaded — see the module docs.
    SignIn(String),
    SignOut,
    /// `None` when the read failed. A failed read is not an empty ledger.
    EntriesPulled(Option<Vec<Value>>),
    PulledPushDone(bool),
    /// Outer `None` is a failed read; inner `None` is an account with no config
    /// yet. Collapsing the two is what let a new device push its defaults over
    /// an existing account's config.
    ConfigPulled(Option<Option<Value>>),
    ConfigPushDone(bool),
    FlushDone(FlushOutcome),
    /// Sections the user just edited, and when. An entry-only edit passes an
    /// empty list — entries are not a config section and carry their own
    /// stamps.
    LocalEdit {
        sections: Vec<String>,
        now: i64,
    },
    /// A row arrived on the entries channel. `None` for a payload with no
    /// usable row, which the TypeScript shrugs off rather than throwing.
    RealtimeEntry(Option<Value>),
    /// A blob arrived on the config channel.
    RealtimeConfig(Option<Value>),
    TimerFired(Timer),
    /// The "retry sync" button: flush now, cancelling any backoff.
    RetryNow,
}

/// Everything the orchestration remembers between events.
///
/// The ledger is **not** here. It lives in the store, and is passed in on the
/// events that need it, for the same reason the clock is passed in: one copy of
/// the ledger is the architecture, and a second one inside the sync engine
/// would be a second thing to drift.
#[derive(Debug, Clone, Default)]
pub struct Engine {
    user: Option<String>,
    status: Status,
    watermark: f64,
    /// Zero means "not currently backing off", so the first failure after a
    /// success waits `base` rather than nothing.
    retry_delay: i64,
    retry_pending: bool,
    stamps: Stamps,
    /// Whether the channels are open — a start-up that failed never opened
    /// them, so a later sign-out has none to close.
    subscribed: bool,
    /// Whether the root store subscription is wired, which is what makes a
    /// local edit schedule a push.
    started: bool,
}

impl Engine {
    pub fn new() -> Engine {
        Engine::default()
    }

    pub fn status(&self) -> Status {
        self.status
    }

    pub fn watermark(&self) -> f64 {
        self.watermark
    }

    pub fn stamps(&self) -> &Stamps {
        &self.stamps
    }

    /// Seed the stamps from storage, before the first [`Event::SignIn`].
    pub fn set_stamps(&mut self, s: Stamps) {
        self.stamps = s;
    }

    pub fn user(&self) -> Option<&str> {
        self.user.as_deref()
    }

    /// One event in, the effects it produces out, in the order the TypeScript
    /// performs them.
    ///
    /// `entries` is the store's current ledger. Passing it on every event
    /// rather than holding it is what keeps this machine pure: two calls with
    /// the same state and the same ledger answer the same way, which is what
    /// the corpus checks.
    pub fn step(&mut self, ev: Event, entries: &[Value]) -> Vec<Effect> {
        match ev {
            Event::SignIn(user) => self.sign_in(user),
            Event::SignOut => self.sign_out(),
            Event::EntriesPulled(rows) => self.entries_pulled(rows, entries),
            Event::PulledPushDone(ok) => self.pulled_push_done(ok),
            Event::ConfigPulled(blob) => self.config_pulled(blob),
            Event::ConfigPushDone(ok) => self.config_push_done(ok),
            Event::FlushDone(outcome) => self.flush_done(outcome, entries),
            Event::LocalEdit { sections, now } => self.local_edit(&sections, now),
            Event::RealtimeEntry(row) => self.realtime_entry(row, entries),
            Event::RealtimeConfig(blob) => self.realtime_config(blob),
            Event::TimerFired(t) => self.timer_fired(t, entries),
            Event::RetryNow => self.retry_now(entries),
        }
    }

    // ---------- start-up ----------

    /// `if (!supabase || activeUser === userId) return;`
    ///
    /// Signing in as a *different* user without a sign-out in between does not
    /// tear the old channels down. That is what the TypeScript does — Supabase
    /// emits a null session between two users in practice — and it is left
    /// alone rather than quietly improved, because an engine that diverges from
    /// the shipping one is worth less than one that is faithful.
    fn sign_in(&mut self, user: String) -> Vec<Effect> {
        if self.user.as_deref() == Some(user.as_str()) {
            return Vec::new();
        }
        self.user = Some(user);
        self.started = false;
        self.status = Status::Syncing;
        vec![Effect::Status(Status::Syncing), Effect::PullEntries]
    }

    fn entries_pulled(&mut self, rows: Option<Vec<Value>>, local: &[Value]) -> Vec<Effect> {
        if self.user.is_none() {
            return Vec::new(); // signed out while the read was in flight
        }
        let Some(remote) = rows else {
            return self.fail_start();
        };
        let m = merge_by_id(local, &remote);
        // `merged.reduce((m, e) => Math.max(m, e.updatedAt ?? 0), 0)`, then
        // `bumpWatermark`. The zero seed is inert — the outer `bump_by` is what
        // keeps the watermark from moving backwards, so an empty merge leaves
        // it alone whatever the seed was. Written this way because that is how
        // the TypeScript is written, not because the seed decides anything: an
        // injection replacing it with negative infinity changed nothing across
        // 2,600 scripts, which is the honest reading.
        let newest = m
            .merged
            .iter()
            .fold(0.0, |acc, e| bump_by(acc, updated_at(e)));
        self.watermark = bump_by(self.watermark, newest);
        let mut out = vec![Effect::SetEntries(m.merged)];
        if !m.conflicts.is_empty() {
            out.push(Effect::LogConflicts(m.conflicts));
        }
        out.push(Effect::PushPulled(m.to_push));
        out
    }

    fn pulled_push_done(&mut self, ok: bool) -> Vec<Effect> {
        if self.user.is_none() {
            return Vec::new();
        }
        if !ok {
            return self.fail_start();
        }
        vec![Effect::PullConfig]
    }

    fn config_pulled(&mut self, blob: Option<Option<Value>>) -> Vec<Effect> {
        if self.user.is_none() {
            return Vec::new();
        }
        // A failed read throws rather than falling through. On a failure
        // `remote` is undefined, which is indistinguishable from "this account
        // has no config yet" — so the device would skip adopting the cloud
        // config and immediately push its own defaults over it, silently wiping
        // an existing account on a new device.
        let Some(remote) = blob else {
            return self.fail_start();
        };
        let mut out = Vec::new();
        if let Some(v) = remote.filter(|v| !blob_is_empty(v)) {
            out.extend(self.apply_config(&v));
        }
        out.push(Effect::PushConfig);
        out
    }

    fn config_push_done(&mut self, ok: bool) -> Vec<Effect> {
        if self.user.is_none() {
            return Vec::new();
        }
        if !ok {
            return self.fail_start();
        }
        self.started = true;
        self.subscribed = true;
        self.status = Status::Synced;
        vec![
            Effect::Subscribe(Channel::Entries),
            Effect::Subscribe(Channel::Config),
            Effect::Status(Status::Synced),
            Effect::LastSync,
        ]
    }

    /// Any failure inside `start`'s try block: the status goes to error and the
    /// rest of the sequence does not run. No channels are opened, which is why
    /// a later sign-out has none to close.
    fn fail_start(&mut self) -> Vec<Effect> {
        self.status = Status::Error;
        vec![Effect::Status(Status::Error)]
    }

    // ---------- the steady state ----------

    fn local_edit(&mut self, sections: &[String], now: i64) -> Vec<Effect> {
        let mut out = Vec::new();
        if !sections.is_empty() {
            for k in sections {
                self.stamps.set(k, now);
            }
            out.push(Effect::SaveStamps);
        }
        // The root subscription is only wired once start-up finishes, so an
        // edit made before that — or after a sign-out — schedules nothing. The
        // stamps are wired separately and for the whole life of the app: an
        // offline edit made while signed out still has to beat a stale cloud
        // section after the next sign-in.
        if self.started {
            out.push(Effect::SetTimer(Timer::Debounce, DEBOUNCE_MS));
        }
        out
    }

    fn realtime_entry(&mut self, row: Option<Value>, local: &[Value]) -> Vec<Effect> {
        // `if (!row || !row.id) return;` — a malformed payload is shrugged off
        let Some(e) = row.filter(has_id) else {
            return Vec::new();
        };
        let stamp = updated_at(&e);
        let m = merge_one(local, &e);
        let changed = m.rows != local;
        let mut out = vec![Effect::SetEntries(m.rows)];
        if !m.conflicts.is_empty() {
            out.push(Effect::LogConflicts(m.conflicts));
        }
        // Two independent reasons to schedule, and the TypeScript has both:
        //
        // * the merge kept something the message did not know about, so the
        //   server needs it — `if (push) pusher.schedule()`, written out;
        // * the store was written and the root subscription is watching it,
        //   which is easy to miss because it is not written anywhere near here.
        //   `applyingRemote` guards the config path but not this one.
        //
        // The second only fires on a real change: the store notifies on a
        // change, not on a call, and `mergeOne` hands back a fresh array
        // whether or not it resolved to anything different. A device's own echo
        // therefore wakes nothing at all — neither reason applies to it.
        if changed || m.push.is_some() {
            out.push(Effect::SetTimer(Timer::Debounce, DEBOUNCE_MS));
        }
        if m.push.is_none() {
            // Nothing of ours was missing from the message, so this is our own
            // echo and the watermark may move past it. When the merge DID
            // contribute something the watermark must not advance, or the
            // scheduler would skip the very row it needs to send.
            self.watermark = bump_by(self.watermark, stamp);
        }
        out
    }

    fn realtime_config(&mut self, blob: Option<Value>) -> Vec<Effect> {
        let Some(v) = blob.filter(|v| !blob_is_empty(v)) else {
            return Vec::new();
        };
        let remote = blob_stamps(&v);
        let mut out = self.apply_config(&v);
        // The server blob lags local edits — another device pushed while ours
        // was still debouncing — so push to make the server converge. A section
        // just adopted can never come back true here, or two devices would
        // trade one blob forever.
        if crate::sync::local_newer_than(&self.stamps, remote.as_ref()) {
            out.push(Effect::SetTimer(Timer::Debounce, DEBOUNCE_MS));
        }
        out
    }

    fn apply_config(&mut self, v: &Value) -> Vec<Effect> {
        let remote = blob_stamps(v);
        let a =
            crate::sync::adopt_sections(&self.stamps, remote.as_ref(), |k| section_present(v, k));
        self.stamps = a.stamps;
        vec![Effect::ApplyConfig(a.take), Effect::SaveStamps]
    }

    fn timer_fired(&mut self, t: Timer, entries: &[Value]) -> Vec<Effect> {
        if t == Timer::Retry {
            self.retry_pending = false;
        }
        self.flush(entries)
    }

    /// `retrySync()` → `flushNow()`: cancel the pending retry, reset the
    /// backoff, and flush immediately.
    fn retry_now(&mut self, entries: &[Value]) -> Vec<Effect> {
        if self.user.is_none() {
            return Vec::new();
        }
        let mut out = Vec::new();
        if self.retry_pending {
            self.retry_pending = false;
            out.push(Effect::ClearTimer(Timer::Retry));
        }
        self.retry_delay = 0;
        out.extend(self.flush(entries));
        out
    }

    fn flush(&mut self, entries: &[Value]) -> Vec<Effect> {
        let dirty = dirty_since_by(entries, updated_at, self.watermark)
            .into_iter()
            .cloned()
            .collect();
        vec![Effect::Flush(dirty)]
    }

    fn flush_done(&mut self, outcome: FlushOutcome, entries: &[Value]) -> Vec<Effect> {
        // What the flush had in hand is recomputed rather than remembered. The
        // watermark still describes the same set, and holding a copy would be a
        // second place for the dirty rule to live — two spellings of one rule
        // is how the realtime path came to disagree with the pull.
        let dirty = dirty_since_by(entries, updated_at, self.watermark);
        match outcome {
            FlushOutcome::EntriesFailed => {
                self.status = Status::Error;
                let mut out = vec![Effect::Status(Status::Error)];
                out.extend(self.schedule_retry());
                out
            }
            FlushOutcome::ConfigFailed => {
                // the rows landed before the config attempt did not
                self.watermark = advance_by(self.watermark, &dirty, updated_at);
                self.status = Status::Error;
                let mut out = vec![Effect::Status(Status::Error)];
                out.extend(self.schedule_retry());
                out
            }
            FlushOutcome::Ok => {
                self.watermark = advance_by(self.watermark, &dirty, updated_at);
                self.retry_delay = 0;
                let mut out = Vec::new();
                if self.retry_pending {
                    self.retry_pending = false;
                    out.push(Effect::ClearTimer(Timer::Retry));
                }
                // `if (status === 'error') status = 'synced'` — a success while
                // already synced is not a status change, only a new lastSync
                if self.status == Status::Error {
                    self.status = Status::Synced;
                    out.push(Effect::Status(Status::Synced));
                }
                out.push(Effect::LastSync);
                out
            }
        }
    }

    /// `if (retryTimer) return;` — one retry pending at a time, and the delay
    /// doubles only when a new one is actually armed.
    fn schedule_retry(&mut self) -> Vec<Effect> {
        if self.retry_pending {
            return Vec::new();
        }
        self.retry_pending = true;
        self.retry_delay = next_delay(self.retry_delay, RETRY_BASE_MS, RETRY_MAX_MS);
        vec![Effect::SetTimer(Timer::Retry, self.retry_delay)]
    }

    fn sign_out(&mut self) -> Vec<Effect> {
        let was_subscribed = self.subscribed;
        self.user = None;
        self.started = false;
        self.subscribed = false;
        self.retry_pending = false;
        self.retry_delay = 0;
        self.watermark = 0.0;
        self.status = Status::Off;
        let mut out = Vec::new();
        if was_subscribed {
            out.push(Effect::Unsubscribe(Channel::Entries));
            out.push(Effect::Unsubscribe(Channel::Config));
        }
        out.push(Effect::ClearTimer(Timer::Debounce));
        out.push(Effect::ClearTimer(Timer::Retry));
        out.push(Effect::Status(Status::Off));
        out
    }
}

// ---------- reading a row and a config blob ----------

/// `!row.id` — truthy, so a missing id and an empty one are the same thing.
fn has_id(v: &Value) -> bool {
    match v.get("id") {
        Some(Value::Str(s)) => !s.is_empty(),
        Some(Value::Num(n)) => *n != 0.0 && !n.is_nan(),
        _ => false,
    }
}

/// `Object.keys(remote).length === 0` — an empty blob is ignored rather than
/// adopted, so a profile row that exists but holds `{}` does not wipe a device.
pub fn blob_is_empty(v: &Value) -> bool {
    match v {
        Value::Obj(o) => o.is_empty(),
        _ => true,
    }
}

/// `blob[k] != null` — **nullish**, not truthy.
///
/// The distinction is the one `configMerge.ts` records: `curLedger` is a string
/// and `''` is a legitimate value for it, so a truthy test would refuse to
/// adopt a remote section that says "no ledger selected".
pub fn section_present(v: &Value, k: &str) -> bool {
    !matches!(v.get(k), None | Some(Value::Null))
}

/// The blob's `configTs`, or `None` when it carries none.
///
/// A blob with no stamps at all is a legacy one, and
/// [`crate::sync::adopt_sections`] reads its sections as stamped `1` — enough
/// to win on a fresh device and to lose to any real edit.
pub fn blob_stamps(v: &Value) -> Option<Stamps> {
    let Some(Value::Obj(m)) = v.get("configTs") else {
        return None;
    };
    Some(
        m.iter()
            .filter_map(|(k, val)| match val {
                Value::Num(n) => Some((k.clone(), *n as i64)),
                _ => None,
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obj(pairs: &[(&str, Value)]) -> Value {
        Value::Obj(
            pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.clone()))
                .collect(),
        )
    }

    fn s(v: &str) -> Value {
        Value::Str(v.to_string())
    }

    fn n(v: f64) -> Value {
        Value::Num(v)
    }

    /// A row with an id and a stamp.
    fn e(id: &str, updated: f64) -> Value {
        obj(&[("id", s(id)), ("updatedAt", n(updated)), ("amt", n(10.0))])
    }

    fn ts(pairs: &[(&str, i64)]) -> Value {
        Value::Obj(
            pairs
                .iter()
                .map(|(k, v)| (k.to_string(), n(*v as f64)))
                .collect(),
        )
    }

    /// Sign in and get all the way to synced.
    fn started(local: &[Value], remote: Vec<Value>) -> Engine {
        let mut en = Engine::new();
        en.step(Event::SignIn("u1".into()), local);
        en.step(Event::EntriesPulled(Some(remote)), local);
        en.step(Event::PulledPushDone(true), local);
        en.step(Event::ConfigPulled(Some(None)), local);
        en.step(Event::ConfigPushDone(true), local);
        en
    }

    // ---------- start-up ----------

    #[test]
    fn sign_in_pulls_before_anything_else() {
        let mut en = Engine::new();
        let fx = en.step(Event::SignIn("u1".into()), &[]);
        assert_eq!(
            fx,
            vec![Effect::Status(Status::Syncing), Effect::PullEntries]
        );
    }

    #[test]
    fn signing_in_as_the_same_user_twice_does_nothing() {
        let mut en = Engine::new();
        en.step(Event::SignIn("u1".into()), &[]);
        assert!(en.step(Event::SignIn("u1".into()), &[]).is_empty());
    }

    #[test]
    fn the_pull_merges_and_pushes_what_the_server_lacks() {
        let local = [e("local1", 9.0)];
        let mut en = Engine::new();
        en.step(Event::SignIn("u1".into()), &local);
        let fx = en.step(
            Event::EntriesPulled(Some(vec![e("remote1", 5000.0)])),
            &local,
        );

        let Effect::SetEntries(rows) = &fx[0] else {
            panic!("expected SetEntries, got {:?}", fx[0])
        };
        assert_eq!(rows.len(), 2);

        let Some(Effect::PushPulled(push)) = fx.last() else {
            panic!("expected PushPulled, got {fx:?}")
        };
        assert_eq!(push.len(), 1);
        assert_eq!(push[0].get("id"), Some(&s("local1")));
    }

    #[test]
    fn the_watermark_rises_to_the_newest_merged_row() {
        let local = [e("local1", 9.0)];
        let mut en = Engine::new();
        en.step(Event::SignIn("u1".into()), &local);
        en.step(
            Event::EntriesPulled(Some(vec![e("remote1", 5000.0)])),
            &local,
        );
        assert_eq!(en.watermark(), 5000.0);
    }

    #[test]
    fn a_failed_pull_is_an_error_and_stops_the_sequence() {
        let mut en = Engine::new();
        en.step(Event::SignIn("u1".into()), &[]);
        let fx = en.step(Event::EntriesPulled(None), &[]);
        assert_eq!(fx, vec![Effect::Status(Status::Error)]);
        assert_eq!(en.status(), Status::Error);
    }

    #[test]
    fn a_failed_config_read_does_not_push_over_the_cloud_copy() {
        let mut en = Engine::new();
        en.step(Event::SignIn("u1".into()), &[]);
        en.step(Event::EntriesPulled(Some(vec![])), &[]);
        en.step(Event::PulledPushDone(true), &[]);
        let fx = en.step(Event::ConfigPulled(None), &[]);
        assert_eq!(fx, vec![Effect::Status(Status::Error)]);
    }

    #[test]
    fn an_account_with_no_config_yet_still_pushes_its_own() {
        let mut en = Engine::new();
        en.step(Event::SignIn("u1".into()), &[]);
        en.step(Event::EntriesPulled(Some(vec![])), &[]);
        en.step(Event::PulledPushDone(true), &[]);
        assert_eq!(
            en.step(Event::ConfigPulled(Some(None)), &[]),
            vec![Effect::PushConfig]
        );
    }

    #[test]
    fn an_empty_remote_blob_is_ignored_rather_than_adopted() {
        let mut en = Engine::new();
        en.step(Event::SignIn("u1".into()), &[]);
        en.step(Event::EntriesPulled(Some(vec![])), &[]);
        en.step(Event::PulledPushDone(true), &[]);
        let fx = en.step(Event::ConfigPulled(Some(Some(obj(&[])))), &[]);
        assert_eq!(fx, vec![Effect::PushConfig]);
    }

    #[test]
    fn both_channels_open_only_after_the_config_push_lands() {
        let mut en = started(&[], vec![]);
        assert_eq!(en.status(), Status::Synced);
        let fx = en.step(Event::SignOut, &[]);
        assert_eq!(fx[0], Effect::Unsubscribe(Channel::Entries));
        assert_eq!(fx[1], Effect::Unsubscribe(Channel::Config));
    }

    #[test]
    fn a_start_that_failed_has_no_channels_to_close() {
        let mut en = Engine::new();
        en.step(Event::SignIn("u1".into()), &[]);
        en.step(Event::EntriesPulled(None), &[]);
        let fx = en.step(Event::SignOut, &[]);
        assert!(!fx.iter().any(|f| matches!(f, Effect::Unsubscribe(_))));
    }

    // ---------- the debounce and the watermark ----------

    #[test]
    fn a_local_edit_stamps_its_sections_and_schedules_a_push() {
        let mut en = started(&[], vec![]);
        let fx = en.step(
            Event::LocalEdit {
                sections: vec!["accounts".into()],
                now: 1234,
            },
            &[],
        );
        assert_eq!(
            fx,
            vec![
                Effect::SaveStamps,
                Effect::SetTimer(Timer::Debounce, DEBOUNCE_MS)
            ]
        );
        assert_eq!(en.stamps().get("accounts"), Some(1234));
    }

    #[test]
    fn an_entry_only_edit_schedules_without_stamping_a_section() {
        let mut en = started(&[], vec![]);
        let fx = en.step(
            Event::LocalEdit {
                sections: vec![],
                now: 1234,
            },
            &[],
        );
        assert_eq!(fx, vec![Effect::SetTimer(Timer::Debounce, DEBOUNCE_MS)]);
    }

    #[test]
    fn an_edit_after_sign_out_stamps_but_schedules_nothing() {
        let mut en = started(&[], vec![]);
        en.step(Event::SignOut, &[]);
        let fx = en.step(
            Event::LocalEdit {
                sections: vec!["tags".into()],
                now: 7,
            },
            &[],
        );
        assert_eq!(fx, vec![Effect::SaveStamps]);
        assert_eq!(en.stamps().get("tags"), Some(7));
    }

    #[test]
    fn the_flush_sends_rows_newer_than_the_watermark() {
        let rows = [e("a", 5.0), e("b", 50.0)];
        // started against an EMPTY pull, so the watermark is still zero and
        // both rows are dirty
        let mut en = started(&[], vec![]);
        assert_eq!(en.watermark(), 0.0);
        let fx = en.step(Event::TimerFired(Timer::Debounce), &rows);
        let Effect::Flush(dirty) = &fx[0] else {
            panic!("expected Flush, got {:?}", fx[0])
        };
        assert_eq!(dirty.len(), 2);
    }

    #[test]
    fn a_pull_that_saw_the_rows_leaves_nothing_dirty() {
        let rows = [e("a", 5.0), e("b", 50.0)];
        let mut en = started(&rows, vec![e("a", 5.0), e("b", 50.0)]);
        assert_eq!(en.watermark(), 50.0);
        assert_eq!(
            en.step(Event::TimerFired(Timer::Debounce), &rows),
            vec![Effect::Flush(vec![])]
        );
    }

    #[test]
    fn the_config_is_pushed_even_with_no_dirty_rows() {
        let mut en = started(&[], vec![]);
        let fx = en.step(Event::TimerFired(Timer::Debounce), &[]);
        assert_eq!(fx, vec![Effect::Flush(vec![])]);
    }

    #[test]
    fn a_successful_flush_advances_the_watermark_past_what_it_sent() {
        let rows = [e("a", 5.0), e("b", 50.0)];
        let mut en = started(&[], vec![]);
        en.step(Event::TimerFired(Timer::Debounce), &rows);
        en.step(Event::FlushDone(FlushOutcome::Ok), &rows);
        assert_eq!(en.watermark(), 50.0);
    }

    #[test]
    fn a_failed_entry_push_leaves_the_watermark_where_it_was() {
        let rows = [e("a", 50.0)];
        let mut en = started(&[], vec![]);
        en.step(Event::TimerFired(Timer::Debounce), &rows);
        let fx = en.step(Event::FlushDone(FlushOutcome::EntriesFailed), &rows);
        assert_eq!(en.watermark(), 0.0);
        assert_eq!(fx[0], Effect::Status(Status::Error));
        assert_eq!(fx[1], Effect::SetTimer(Timer::Retry, RETRY_BASE_MS));
    }

    #[test]
    fn a_config_failure_after_the_rows_landed_still_advances_the_watermark() {
        let rows = [e("a", 50.0)];
        let mut en = started(&[], vec![]);
        en.step(Event::TimerFired(Timer::Debounce), &rows);
        en.step(Event::FlushDone(FlushOutcome::ConfigFailed), &rows);
        assert_eq!(en.watermark(), 50.0);
        assert_eq!(en.status(), Status::Error);
    }

    #[test]
    fn the_backoff_doubles_and_caps() {
        let mut en = started(&[], vec![]);
        let mut delays = Vec::new();
        for _ in 0..6 {
            en.step(Event::TimerFired(Timer::Retry), &[]);
            let fx = en.step(Event::FlushDone(FlushOutcome::EntriesFailed), &[]);
            if let Some(Effect::SetTimer(Timer::Retry, d)) = fx.last() {
                delays.push(*d);
            }
        }
        assert_eq!(delays, [2_000, 4_000, 8_000, 16_000, 32_000, 60_000]);
    }

    #[test]
    fn only_one_retry_is_ever_pending() {
        let mut en = started(&[], vec![]);
        en.step(Event::TimerFired(Timer::Debounce), &[]);
        en.step(Event::FlushDone(FlushOutcome::EntriesFailed), &[]);
        // a second failure while one is armed does not arm another
        let fx = en.step(Event::FlushDone(FlushOutcome::EntriesFailed), &[]);
        assert_eq!(fx, vec![Effect::Status(Status::Error)]);
    }

    #[test]
    fn a_success_while_already_synced_is_not_a_status_change() {
        let mut en = started(&[], vec![]);
        let fx = en.step(Event::FlushDone(FlushOutcome::Ok), &[]);
        assert_eq!(fx, vec![Effect::LastSync]);
    }

    #[test]
    fn retry_now_cancels_the_backoff_and_flushes() {
        let mut en = started(&[], vec![]);
        en.step(Event::TimerFired(Timer::Debounce), &[]);
        en.step(Event::FlushDone(FlushOutcome::EntriesFailed), &[]);
        let fx = en.step(Event::RetryNow, &[]);
        assert_eq!(
            fx,
            vec![Effect::ClearTimer(Timer::Retry), Effect::Flush(vec![])]
        );
        // and the next failure starts the backoff from base again
        let fx = en.step(Event::FlushDone(FlushOutcome::EntriesFailed), &[]);
        assert_eq!(fx[1], Effect::SetTimer(Timer::Retry, RETRY_BASE_MS));
    }

    #[test]
    fn retry_now_while_signed_out_does_nothing() {
        let mut en = Engine::new();
        assert!(en.step(Event::RetryNow, &[]).is_empty());
    }

    // ---------- realtime ----------

    #[test]
    fn a_realtime_row_the_device_lacks_is_taken_without_a_push() {
        let mut en = started(&[], vec![]);
        let fx = en.step(Event::RealtimeEntry(Some(e("new1", 8000.0))), &[]);
        let Effect::SetEntries(rows) = &fx[0] else {
            panic!("expected SetEntries, got {:?}", fx[0])
        };
        assert_eq!(rows.len(), 1);
        // the store changed, so a push is scheduled — but the watermark moved
        // past the row, so that push carries the config and no rows
        assert!(fx.contains(&Effect::SetTimer(Timer::Debounce, DEBOUNCE_MS)));
        assert_eq!(en.watermark(), 8000.0);
    }

    #[test]
    fn a_realtime_row_identical_to_the_local_one_wakes_nothing() {
        // a device's own echo: the merge resolves to what is already there, the
        // store is written with an equal value and does not notify
        let rows = [e("r1", 5000.0)];
        let mut en = started(&[], vec![]);
        let fx = en.step(Event::RealtimeEntry(Some(e("r1", 5000.0))), &rows);
        assert_eq!(fx, vec![Effect::SetEntries(rows.to_vec())]);
        assert_eq!(en.watermark(), 5000.0);
    }

    #[test]
    fn a_realtime_row_that_loses_a_field_merge_schedules_a_push_instead() {
        // ours carries a note the message does not know about, so the merge
        // contributes something the server lacks — the watermark must not move
        let local = obj(&[
            ("id", s("r1")),
            ("updatedAt", n(1000.0)),
            ("amt", n(10.0)),
            ("note", s("mine")),
            ("fieldTs", ts(&[("note", 1000), ("amt", 500)])),
        ]);
        let remote = obj(&[
            ("id", s("r1")),
            ("updatedAt", n(2000.0)),
            ("amt", n(99.0)),
            ("note", s("theirs")),
            ("fieldTs", ts(&[("amt", 2000), ("note", 500)])),
        ]);

        let rows = [local];
        let mut en = started(&[], vec![]);
        let fx = en.step(Event::RealtimeEntry(Some(remote)), &rows);
        let Effect::SetEntries(merged) = &fx[0] else {
            panic!("expected SetEntries, got {:?}", fx[0])
        };
        assert_eq!(merged[0].get("amt"), Some(&n(99.0)));
        assert_eq!(merged[0].get("note"), Some(&s("mine")));
        assert!(fx.contains(&Effect::SetTimer(Timer::Debounce, DEBOUNCE_MS)));
        assert_eq!(en.watermark(), 0.0);
    }

    #[test]
    fn a_malformed_realtime_payload_is_shrugged_off() {
        let mut en = started(&[], vec![]);
        assert!(en.step(Event::RealtimeEntry(None), &[]).is_empty());
        assert!(en
            .step(Event::RealtimeEntry(Some(obj(&[]))), &[])
            .is_empty());
        assert!(en
            .step(Event::RealtimeEntry(Some(obj(&[("id", s(""))]))), &[])
            .is_empty());
    }

    // ---------- the config channel ----------

    #[test]
    fn a_remote_config_is_adopted_section_by_section() {
        let mut en = started(&[], vec![]);
        en.step(
            Event::LocalEdit {
                sections: vec!["accounts".into()],
                now: 10_000,
            },
            &[],
        );
        let blob = obj(&[
            ("accounts", Value::Arr(vec![])),
            ("tags", Value::Arr(vec![])),
            ("configTs", ts(&[("accounts", 1), ("tags", 99_999)])),
        ]);
        let fx = en.step(Event::RealtimeConfig(Some(blob)), &[]);
        // ours is newer for accounts; theirs is newer for tags
        assert_eq!(fx[0], Effect::ApplyConfig(vec!["tags".to_string()]));
        // and the server is behind on accounts, so it gets a push
        assert!(fx.contains(&Effect::SetTimer(Timer::Debounce, DEBOUNCE_MS)));
    }

    #[test]
    fn an_adopted_section_does_not_immediately_push_back() {
        let mut en = started(&[], vec![]);
        let blob = obj(&[("tags", Value::Arr(vec![]))]);
        let fx = en.step(Event::RealtimeConfig(Some(blob)), &[]);
        assert_eq!(fx[0], Effect::ApplyConfig(vec!["tags".to_string()]));
        assert!(!fx.iter().any(|f| matches!(f, Effect::SetTimer(..))));
    }

    #[test]
    fn an_empty_realtime_config_changes_nothing() {
        let mut en = started(&[], vec![]);
        assert!(en
            .step(Event::RealtimeConfig(Some(obj(&[]))), &[])
            .is_empty());
        assert!(en.step(Event::RealtimeConfig(None), &[]).is_empty());
    }

    // ---------- sign-out ----------

    #[test]
    fn signing_out_closes_everything_and_stops_scheduling() {
        let mut en = started(&[], vec![]);
        let fx = en.step(Event::SignOut, &[]);
        assert_eq!(
            fx,
            vec![
                Effect::Unsubscribe(Channel::Entries),
                Effect::Unsubscribe(Channel::Config),
                Effect::ClearTimer(Timer::Debounce),
                Effect::ClearTimer(Timer::Retry),
                Effect::Status(Status::Off),
            ]
        );
        assert_eq!(en.watermark(), 0.0);
    }

    // ---------- reading a blob ----------

    #[test]
    fn a_section_present_test_is_nullish_not_truthy() {
        let v = obj(&[("curLedger", s("")), ("lang", Value::Null)]);
        assert!(section_present(&v, "curLedger")); // '' is a real value
        assert!(!section_present(&v, "lang"));
        assert!(!section_present(&v, "tags"));
    }

    #[test]
    fn a_blob_with_no_stamps_reads_as_none() {
        assert_eq!(blob_stamps(&obj(&[("tags", Value::Arr(vec![]))])), None);
        let s = blob_stamps(&obj(&[("configTs", ts(&[("tags", 5)]))])).unwrap();
        assert_eq!(s.get("tags"), Some(5));
    }
}
