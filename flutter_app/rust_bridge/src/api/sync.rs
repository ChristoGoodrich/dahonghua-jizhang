//! The sync engine across the boundary.
//!
//! The division is sharper here than anywhere else in the bridge, because the
//! module's whole subject is I/O and the whole point of porting it was to keep
//! the I/O out. Dart does five things: fetch, upload, subscribe, hold two
//! timers, and show a status. It decides none of them — not the order, not what
//! a failure means, not which rows are dirty, not which config sections win.
//!
//! Two kinds of effect never reach Dart at all. `SetEntries` and `ApplyConfig`
//! write the store, and the store is Rust's — surfacing them would invite a
//! second copy of the ledger on the Dart side, which is the thing this
//! architecture exists to prevent. They are applied here and Dart is not told.
//!
//! What crosses is JSON, because JSON is what crosses the wire anyway. Dart
//! never inspects it: it posts the string it was handed and hands back the
//! string it got.
//!
//! **The caller's obligations**, restated from [`dahonghua_core::engine`]
//! because they are easy to break from Dart:
//!
//! * `sign_in` means the local ledger is already loaded.
//! * A store write made *for* an `ApplyConfig` must not be reported back as a
//!   local edit. This bridge applies those writes itself precisely so Dart
//!   cannot get that wrong.
//! * Every event that needs a clock is given one.

use dahonghua_core::engine::{Channel, Effect, Engine, Event, FlushOutcome, Timer};
use dahonghua_core::jsval::{parse_checked, stable, Value};
use dahonghua_core::ledger::Ledger;
use dahonghua_core::rows::{entry_from_value, entry_to_value};
use dahonghua_core::sync::{Stamps, CONFIG_SECTIONS};
use flutter_rust_bridge::frb;
use std::sync::{Mutex, MutexGuard, OnceLock};

use super::store::{load_config, snapshot_config, store};

fn engine() -> MutexGuard<'static, Engine> {
    static EN: OnceLock<Mutex<Engine>> = OnceLock::new();
    let m = EN.get_or_init(|| Mutex::new(Engine::new()));
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// One thing for Dart to do.
///
/// A tagged struct rather than an enum with payloads: the payloads are all
/// either a JSON string, a name, or a number, and one flat shape crosses more
/// cleanly than twelve variants would.
#[derive(Debug, Clone, PartialEq)]
pub struct SyncEffect {
    /// `pullEntries` | `pullConfig` | `pushPulled` | `pushConfig` | `flush`
    /// | `subscribe` | `unsubscribe` | `setTimer` | `clearTimer` | `status`
    /// | `lastSync` | `saveStamps`
    pub kind: String,
    /// Rows to upload, as a JSON array. Empty when the effect carries none.
    ///
    /// A `flush` with an empty array still has to happen: the config is pushed
    /// either way, and that is what makes an accounts-only change reach the
    /// cloud.
    pub json: String,
    /// `entries` | `config` for the channels, `debounce` | `retry` for the
    /// timers, the status name for `status`.
    pub name: String,
    /// Milliseconds, for `setTimer` only.
    pub ms: i64,
}

fn effect(kind: &str) -> SyncEffect {
    SyncEffect {
        kind: kind.to_string(),
        json: String::new(),
        name: String::new(),
        ms: 0,
    }
}

fn rows_json(rows: &[Value]) -> String {
    let parts: Vec<String> = rows.iter().map(stable).collect();
    format!("[{}]", parts.join(","))
}

/// The ledger as the engine wants it.
///
/// Converted per event rather than held, because holding it would be the second
/// copy this architecture refuses. Events are a handful per second at most; the
/// conversion is a walk over a `Vec`.
fn ledger_values() -> Vec<Value> {
    store().ledger.all().iter().map(entry_to_value).collect()
}

/// Run the effects the engine returned, keeping the ones that belong to the
/// store and handing the rest to Dart.
fn dispatch(fx: Vec<Effect>) -> Vec<SyncEffect> {
    let mut out = Vec::new();
    for f in fx {
        match f {
            Effect::PullEntries => out.push(effect("pullEntries")),
            Effect::PullConfig => out.push(effect("pullConfig")),
            Effect::PushPulled(rows) => out.push(SyncEffect {
                json: rows_json(&rows),
                ..effect("pushPulled")
            }),
            Effect::PushConfig => out.push(effect("pushConfig")),
            Effect::Flush(rows) => out.push(SyncEffect {
                json: rows_json(&rows),
                ..effect("flush")
            }),
            Effect::Subscribe(c) => out.push(SyncEffect {
                name: channel_name(c).to_string(),
                ..effect("subscribe")
            }),
            Effect::Unsubscribe(c) => out.push(SyncEffect {
                name: channel_name(c).to_string(),
                ..effect("unsubscribe")
            }),
            Effect::SetTimer(t, ms) => out.push(SyncEffect {
                name: timer_name(t).to_string(),
                ms,
                ..effect("setTimer")
            }),
            Effect::ClearTimer(t) => out.push(SyncEffect {
                name: timer_name(t).to_string(),
                ..effect("clearTimer")
            }),
            Effect::Status(s) => out.push(SyncEffect {
                name: s.as_str().to_string(),
                ..effect("status")
            }),
            Effect::LastSync => out.push(effect("lastSync")),
            Effect::SaveStamps => out.push(effect("saveStamps")),

            // ---- the two that stay on this side ----
            Effect::SetEntries(rows) => {
                let entries = rows.iter().map(entry_from_value).collect();
                store().ledger = Ledger::from_entries(entries);
            }
            Effect::ApplyConfig(take) => apply_sections(&take),
            // The conflict log is a platform file, and nothing on screen reads
            // it yet. Dropping it here rather than inventing an effect for it
            // keeps the vocabulary to what is actually wired.
            Effect::LogConflicts(_) => {}
        }
    }
    out
}

fn channel_name(c: Channel) -> &'static str {
    match c {
        Channel::Entries => "entries",
        Channel::Config => "config",
    }
}

fn timer_name(t: Timer) -> &'static str {
    match t {
        Timer::Debounce => "debounce",
        Timer::Retry => "retry",
    }
}

/// Write only the sections the engine decided to adopt.
///
/// The blob is filtered down to those keys and handed to the store's own
/// `load_config`, which already knows how to read each one. Passing the whole
/// blob would adopt the sections the merge just decided *against*, which is the
/// clobbering the per-section stamps exist to stop.
fn apply_sections(take: &[String]) {
    if take.is_empty() {
        return;
    }
    let Some(blob) = pending_blob() else { return };
    let Value::Obj(o) = &blob else { return };
    let filtered: Vec<(String, Value)> = o
        .iter()
        .filter(|(k, _)| take.iter().any(|t| t == k))
        .cloned()
        .collect();
    load_config(stable(&Value::Obj(filtered)));
}

/// The blob currently being applied.
///
/// Held for the length of one event rather than passed through the engine: the
/// engine answers *which* sections win, and the values are the store's business.
fn pending() -> MutexGuard<'static, Option<Value>> {
    static P: OnceLock<Mutex<Option<Value>>> = OnceLock::new();
    let m = P.get_or_init(|| Mutex::new(None));
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn set_pending(v: Option<Value>) {
    *pending() = v;
}

fn pending_blob() -> Option<Value> {
    pending().clone()
}

// ---------- events ----------

/// A session appeared. The ledger must already be loaded — see the module docs.
#[frb(sync)]
pub fn sync_sign_in(user_id: String) -> Vec<SyncEffect> {
    let rows = ledger_values();
    let fx = engine().step(Event::SignIn(user_id), &rows);
    dispatch(fx)
}

#[frb(sync)]
pub fn sync_sign_out() -> Vec<SyncEffect> {
    let rows = ledger_values();
    let fx = engine().step(Event::SignOut, &rows);
    dispatch(fx)
}

/// The entries read came back. `json` is `None` when it **failed** — which is
/// not the same as an empty table, and collapsing the two is how a device ends
/// up pushing its defaults over an account that already had data.
#[frb(sync)]
pub fn sync_entries_pulled(json: Option<String>) -> Vec<SyncEffect> {
    let rows = json.and_then(|j| match parse_checked(&j) {
        Some(Value::Arr(items)) => Some(items),
        // A body that will not parse is a failed read, not an empty one.
        _ => None,
    });
    let local = ledger_values();
    let fx = engine().step(Event::EntriesPulled(rows), &local);
    dispatch(fx)
}

#[frb(sync)]
pub fn sync_pulled_push_done(ok: bool) -> Vec<SyncEffect> {
    let rows = ledger_values();
    let fx = engine().step(Event::PulledPushDone(ok), &rows);
    dispatch(fx)
}

/// The config read came back. `ok` false is a failed read; `ok` true with no
/// `json` is an account that has no config yet.
#[frb(sync)]
pub fn sync_config_pulled(ok: bool, json: Option<String>) -> Vec<SyncEffect> {
    let blob = if ok {
        Some(json.and_then(|j| parse_checked(&j)))
    } else {
        None
    };
    set_pending(blob.clone().flatten());
    let rows = ledger_values();
    let fx = engine().step(Event::ConfigPulled(blob), &rows);
    let out = dispatch(fx);
    set_pending(None);
    out
}

#[frb(sync)]
pub fn sync_config_push_done(ok: bool) -> Vec<SyncEffect> {
    let rows = ledger_values();
    let fx = engine().step(Event::ConfigPushDone(ok), &rows);
    dispatch(fx)
}

/// How far a flush got: `entriesFailed` | `configFailed` | `ok`.
///
/// Three outcomes rather than a boolean, because the watermark advances past
/// rows that were persisted even when the config upload after them fails.
#[frb(sync)]
pub fn sync_flush_done(outcome: String) -> Vec<SyncEffect> {
    let o = match outcome.as_str() {
        "ok" => FlushOutcome::Ok,
        "configFailed" => FlushOutcome::ConfigFailed,
        _ => FlushOutcome::EntriesFailed,
    };
    let rows = ledger_values();
    let fx = engine().step(Event::FlushDone(o), &rows);
    dispatch(fx)
}

/// The user changed something. `sections` names the config sections touched; an
/// entry-only edit passes an empty list.
#[frb(sync)]
pub fn sync_local_edit(sections: Vec<String>, now: i64) -> Vec<SyncEffect> {
    let rows = ledger_values();
    let fx = engine().step(Event::LocalEdit { sections, now }, &rows);
    dispatch(fx)
}

/// A row arrived on the entries channel.
#[frb(sync)]
pub fn sync_realtime_entry(json: String) -> Vec<SyncEffect> {
    let row = parse_checked(&json);
    let rows = ledger_values();
    let fx = engine().step(Event::RealtimeEntry(row), &rows);
    dispatch(fx)
}

/// A blob arrived on the config channel.
#[frb(sync)]
pub fn sync_realtime_config(json: String) -> Vec<SyncEffect> {
    let blob = parse_checked(&json);
    set_pending(blob.clone());
    let rows = ledger_values();
    let fx = engine().step(Event::RealtimeConfig(blob), &rows);
    let out = dispatch(fx);
    set_pending(None);
    out
}

/// `debounce` or `retry` elapsed.
#[frb(sync)]
pub fn sync_timer_fired(timer: String) -> Vec<SyncEffect> {
    let t = if timer == "retry" {
        Timer::Retry
    } else {
        Timer::Debounce
    };
    let rows = ledger_values();
    let fx = engine().step(Event::TimerFired(t), &rows);
    dispatch(fx)
}

/// The "retry sync" button.
#[frb(sync)]
pub fn sync_retry_now() -> Vec<SyncEffect> {
    let rows = ledger_values();
    let fx = engine().step(Event::RetryNow, &rows);
    dispatch(fx)
}

// ---------- what Dart needs to build a request ----------

/// The config blob to upload: the store's config plus the section stamps.
#[frb(sync)]
pub fn sync_config_blob() -> String {
    let cfg = snapshot_config();
    let Some(Value::Obj(mut o)) = parse_checked(&cfg) else {
        return cfg;
    };
    let stamps: Vec<(String, Value)> = engine()
        .stamps()
        .entries()
        .iter()
        .map(|(k, v)| (k.clone(), Value::Num(*v as f64)))
        .collect();
    if !stamps.is_empty() {
        o.push(("configTs".to_string(), Value::Obj(stamps)));
    }
    stable(&Value::Obj(o))
}

/// The section stamps, for the platform to persist.
#[frb(sync)]
pub fn sync_stamps_json() -> String {
    let e = engine();
    let o: Vec<(String, Value)> = e
        .stamps()
        .entries()
        .iter()
        .map(|(k, v)| (k.clone(), Value::Num(*v as f64)))
        .collect();
    stable(&Value::Obj(o))
}

/// Restore the stamps at boot, **before** the first sign-in.
///
/// They track local edits regardless of session, so an edit made offline and
/// signed out still has to beat a stale cloud section after the next sign-in.
#[frb(sync)]
pub fn sync_load_stamps(json: String) {
    let Some(Value::Obj(o)) = parse_checked(&json) else {
        return;
    };
    let stamps: Stamps = o
        .iter()
        .filter_map(|(k, v)| match v {
            Value::Num(n) => Some((k.clone(), *n as i64)),
            _ => None,
        })
        .collect();
    engine().set_stamps(stamps);
}

/// `off` | `syncing` | `synced` | `error`.
#[frb(sync)]
pub fn sync_status() -> String {
    engine().status().as_str().to_string()
}

/// The config sections, in the order the merge considers them. Dart names these
/// when it reports a local edit.
#[frb(sync)]
pub fn sync_sections() -> Vec<String> {
    CONFIG_SECTIONS.iter().map(|s| s.to_string()).collect()
}

/// Throw the engine away — for tests, and for a sign-out that must not leave a
/// watermark behind.
#[frb(sync)]
pub fn sync_reset() {
    *engine() = Engine::new();
    set_pending(None);
}
