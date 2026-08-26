//! Rust half of the sync-engine parity harness.
//!
//! The engine decides nothing on its own that can be dumped as a value: it
//! decides an *order of operations against a server*. So what this compares is
//! what a server would see — every upload in the order it arrived, every
//! channel opened and closed, every status the UI showed — plus the ledger and
//! the section stamps left behind.
//!
//! That means both halves of this harness are interpreters. This one executes
//! [`Effect`]s against a fake server and a virtual clock; the TypeScript half
//! (`scripts/engine-parity.harness.ts`) runs the shipping engine against a
//! faked Supabase client and jest's fake timers. The corpus is a script of
//! commands they both replay.
//!
//! The virtual clock starts at a real epoch on both sides, because the section
//! stamps are `Date.now()` and a clock starting at zero would make a genuine
//! local edit indistinguishable from a section never edited.

use dahonghua_core::engine::{Channel, Effect, Engine, Event, FlushOutcome, Status, Timer};
use dahonghua_core::jsval::Value;
use dahonghua_core::merge::updated_at;
use dahonghua_core::sync::{Stamps, CONFIG_SECTIONS};
use std::io::Read;

/// 2023-11-14T22:13:20Z. Any realistic epoch does; zero does not.
const EPOCH: i64 = 1_700_000_000_000;

// ---------- the fake server ----------

#[derive(Default)]
struct Server {
    entries: Vec<Value>,
    profile: Option<Value>,
    fail_pull: bool,
    fail_push: bool,
    /// Fails only the profile upsert. Without it the "rows landed, config did
    /// not" branch is unreachable — and that branch is where the watermark rule
    /// lives, so the sweep scored zero on removing it.
    fail_config_push: bool,
    fail_config_read: bool,
}

impl Server {
    fn upsert(&mut self, rows: &[Value]) {
        for r in rows {
            let id = row_id(r);
            match self.entries.iter().position(|x| row_id(x) == id) {
                Some(i) => self.entries[i] = r.clone(),
                None => self.entries.push(r.clone()),
            }
        }
    }
}

fn row_id(v: &Value) -> String {
    match v.get("id") {
        Some(Value::Str(s)) => s.clone(),
        _ => String::new(),
    }
}

fn row(id: &str, updated: f64, amt: f64) -> Value {
    Value::Obj(vec![
        ("id".into(), Value::Str(id.into())),
        ("updatedAt".into(), Value::Num(updated)),
        ("amt".into(), Value::Num(amt)),
        ("io".into(), Value::Str("exp".into())),
    ])
}

/// A row carrying per-field stamps.
///
/// The field-level merge is the whole reason this port exists — the shipping
/// realtime path compared `updatedAt` and took the whole newer row, which
/// discarded concurrent field edits permanently. Without a row that carries
/// `fieldTs`, the engine corpus never reaches that path at all: the whole-row
/// resolution only reports a push when the LOCAL row wins, and then its stamp
/// is already the higher one, so the watermark rule has nothing to decide.
///
/// `ours` gives the note a late stamp and the amount an early one; `theirs`
/// does the reverse. Merged, each side keeps the field it edited last, and the
/// result is a row the server has never seen — which is exactly the case where
/// the watermark must NOT advance.
fn row_ft(id: &str, updated: f64, ours: bool, stamp: f64) -> Value {
    let (note, amt) = if ours {
        ("mine", 10.0)
    } else {
        ("theirs", 99.0)
    };
    let ft = if ours {
        vec![
            ("note".to_string(), Value::Num(stamp)),
            ("amt".to_string(), Value::Num(1.0)),
        ]
    } else {
        vec![
            ("amt".to_string(), Value::Num(stamp)),
            ("note".to_string(), Value::Num(1.0)),
        ]
    };
    Value::Obj(vec![
        ("id".into(), Value::Str(id.into())),
        ("updatedAt".into(), Value::Num(updated)),
        ("amt".into(), Value::Num(amt)),
        ("io".into(), Value::Str("exp".into())),
        ("note".into(), Value::Str(note.into())),
        ("fieldTs".into(), Value::Obj(ft)),
    ])
}

/// A config blob carrying the named sections, each stamped.
///
/// The section *values* are markers rather than real config: what this harness
/// compares is which sections were adopted and what the stamps became, and the
/// values themselves belong to the store, which is the platform's.
fn blob(specs: &[(String, Option<i64>)]) -> Value {
    let mut o: Vec<(String, Value)> = Vec::new();
    let mut ts: Vec<(String, Value)> = Vec::new();
    for (k, stamp) in specs {
        // A trailing `!` means present but falsy — an empty string, which is
        // what `curLedger` holds for "no ledger selected". The presence test is
        // nullish precisely so that adopts; a truthy one would refuse it, and
        // nothing else in the corpus can tell the two apart.
        let (k, falsy) = match k.strip_suffix('!') {
            Some(base) => (base.to_string(), true),
            None => (k.clone(), false),
        };
        o.push((
            k.clone(),
            if falsy {
                // A zero rather than an empty string: `curLedger`'s own default
                // IS the empty string, so an untouched section would have been
                // indistinguishable from one adopted as empty.
                Value::Num(0.0)
            } else {
                Value::Obj(vec![("v".into(), Value::Str(format!("v-{k}")))])
            },
        ));
        if let Some(s) = stamp {
            ts.push((k.clone(), Value::Num(*s as f64)));
        }
    }
    if !ts.is_empty() {
        o.push(("configTs".into(), Value::Obj(ts)));
    }
    Value::Obj(o)
}

// ---------- the simulation ----------

struct Sim {
    en: Engine,
    store: Vec<Value>,
    server: Server,
    now: i64,
    debounce: Option<i64>,
    retry: Option<i64>,
    log: Vec<String>,
    last_status: Status,
    /// What each config section currently holds: `L` for a local edit, the
    /// blob's own marker for an adopted one, `E` for a section adopted as an
    /// empty string. Without this, ApplyConfig is only visible through the
    /// stamps it sets — so adopting a section whose remote stamp equals the
    /// local one was invisible, and so was the difference between a nullish
    /// presence test and a truthy one.
    config: std::collections::BTreeMap<String, String>,
    /// The blob currently being applied, so ApplyConfig knows what it wrote.
    blob: Option<Value>,
    /// Whether the channels are open. A message can only arrive on a channel
    /// that exists — a start-up that failed subscribed to nothing, so a
    /// realtime command after it must land nowhere, exactly as it does on the
    /// other side where there is no handler to call.
    subscribed: bool,
}

impl Sim {
    fn new() -> Sim {
        Sim {
            en: Engine::new(),
            store: Vec::new(),
            server: Server::default(),
            now: EPOCH,
            debounce: None,
            retry: None,
            log: Vec::new(),
            last_status: Status::Off,
            config: std::collections::BTreeMap::new(),
            blob: None,
            subscribed: false,
        }
    }

    fn send(&mut self, ev: Event) {
        let store = self.store.clone();
        let fx = self.en.step(ev, &store);
        self.run(fx);
    }

    /// Effects in order, each recursing into whatever event it produces —
    /// which is what `await` does on the other side.
    fn run(&mut self, fx: Vec<Effect>) {
        for f in fx {
            self.exec(f);
        }
    }

    fn exec(&mut self, f: Effect) {
        match f {
            Effect::PullEntries => {
                let rows = if self.server.fail_pull {
                    None
                } else {
                    Some(self.server.entries.clone())
                };
                self.send(Event::EntriesPulled(rows));
            }
            Effect::PushPulled(rows) => {
                // `if (!supabase || !entries.length) return;` — an empty push
                // is not attempted, so it cannot fail and is not recorded
                if rows.is_empty() {
                    self.send(Event::PulledPushDone(true));
                    return;
                }
                self.log_entries(&rows);
                if self.server.fail_push {
                    self.send(Event::PulledPushDone(false));
                } else {
                    self.server.upsert(&rows);
                    self.send(Event::PulledPushDone(true));
                }
            }
            Effect::PullConfig => {
                let b = if self.server.fail_config_read {
                    None
                } else {
                    Some(self.server.profile.clone())
                };
                self.blob = b.clone().flatten();
                self.send(Event::ConfigPulled(b));
            }
            Effect::PushConfig => {
                let ok = self.push_config();
                self.send(Event::ConfigPushDone(ok));
            }
            Effect::Flush(rows) => {
                if !rows.is_empty() {
                    self.log_entries(&rows);
                    if self.server.fail_push {
                        self.send(Event::FlushDone(FlushOutcome::EntriesFailed));
                        return;
                    }
                    self.server.upsert(&rows);
                }
                let ok = self.push_config();
                self.send(Event::FlushDone(if ok {
                    FlushOutcome::Ok
                } else {
                    FlushOutcome::ConfigFailed
                }));
            }
            Effect::SetTimer(Timer::Debounce, ms) => self.debounce = Some(self.now + ms),
            Effect::SetTimer(Timer::Retry, ms) => self.retry = Some(self.now + ms),
            Effect::ClearTimer(Timer::Debounce) => self.debounce = None,
            Effect::ClearTimer(Timer::Retry) => self.retry = None,
            Effect::Subscribe(Channel::Entries) => {
                self.subscribed = true;
                self.log.push("+e".into());
            }
            Effect::Subscribe(Channel::Config) => self.log.push("+c".into()),
            Effect::Unsubscribe(Channel::Entries) => {
                self.subscribed = false;
                self.log.push("-e".into());
            }
            Effect::Unsubscribe(Channel::Config) => self.log.push("-c".into()),
            Effect::Status(s) => {
                // only transitions: setting an observable to the value it
                // already holds does not notify on the other side either
                if s != self.last_status {
                    self.last_status = s;
                    self.log.push(format!("!{}", s.as_str()));
                }
            }
            Effect::SetEntries(rows) => self.store = rows,
            Effect::ApplyConfig(take) => {
                for k in take {
                    match self
                        .blob
                        .as_ref()
                        .and_then(|b| b.get(&k))
                        .and_then(render_section)
                    {
                        Some(v) => self.config.insert(k, v),
                        // adopted, but the value carries no marker — the
                        // section is back to something this harness cannot name
                        None => self.config.remove(&k),
                    };
                }
            }
            Effect::SaveStamps => {}
            Effect::LastSync | Effect::LogConflicts(_) => {}
        }
    }

    fn push_config(&mut self) -> bool {
        self.log
            .push(format!("C[{}]", show_stamps(self.en.stamps())));
        if self.server.fail_push || self.server.fail_config_push {
            return false;
        }
        // The blob a device pushes carries its whole config, section values
        // included — and those are the STORE's, not the engine's. Sections this
        // script never wrote go up as something unmarked, exactly as the real
        // snapshot sends the store's defaults; re-adopting one teaches neither
        // side anything, which is what the `None` arm of `render_section` says.
        let mut o: Vec<(String, Value)> = Vec::new();
        let mut ts: Vec<(String, Value)> = Vec::new();
        for k in CONFIG_SECTIONS {
            o.push((
                k.to_string(),
                match self.config.get(k).map(String::as_str) {
                    Some("Z") => Value::Num(0.0),
                    Some(v) => Value::Obj(vec![("v".into(), Value::Str(v.to_string()))]),
                    None => Value::Arr(vec![]),
                },
            ));
            if let Some(t) = self.en.stamps().get(k) {
                ts.push((k.to_string(), Value::Num(t as f64)));
            }
        }
        if !ts.is_empty() {
            o.push(("configTs".into(), Value::Obj(ts)));
        }
        self.server.profile = Some(Value::Obj(o));
        true
    }

    fn log_entries(&mut self, rows: &[Value]) {
        let ids: Vec<String> = rows
            .iter()
            .map(|r| format!("{}@{}", row_id(r), fmt_num(updated_at(r))))
            .collect();
        self.log.push(format!("E[{}]", ids.join(",")));
    }

    /// `jest.advanceTimersByTimeAsync(ms)`: fire every timer due inside the
    /// window, earliest first, letting each one arm the next.
    ///
    /// Bounded, because an injected bug can arm a zero-delay retry that
    /// re-arms itself at the same instant — an infinite loop that grows the log
    /// until the process dies. One sweep did exactly that, asking for 48 GiB,
    /// and an interpreter that dies scores no detection at all: the injection
    /// reads as "not caught" when it was in fact caught catastrophically. The
    /// marker makes it a divergence, which is what it is.
    fn settle(&mut self, ms: i64) {
        let until = self.now + ms;
        for _ in 0..200 {
            let next = [(self.debounce, Timer::Debounce), (self.retry, Timer::Retry)]
                .into_iter()
                .filter_map(|(at, t)| at.filter(|a| *a <= until).map(|a| (a, t)))
                .min_by_key(|(a, _)| *a);
            let Some((at, which)) = next else {
                self.now = until;
                return;
            };
            self.now = at;
            match which {
                Timer::Debounce => self.debounce = None,
                Timer::Retry => self.retry = None,
            }
            self.send(Event::TimerFired(which));
        }
        self.log.push("LOOP".into());
        self.debounce = None;
        self.retry = None;
        self.now = until;
    }
}

/// What a config section's value looks like once written. The values are
/// markers, not real config — the store owns the content, and this only has to
/// tell one write apart from another.
/// `None` for a value this harness does not recognise — the store's own
/// defaults, which a device pushes and re-adopts without either side learning
/// anything. Only a marker counts as "written".
fn render_section(v: &Value) -> Option<String> {
    match v {
        Value::Obj(o) => match o.iter().find(|(k, _)| k == "v") {
            Some((_, Value::Str(s))) => Some(s.clone()),
            _ => None,
        },
        // present but falsy: nullish says yes, truthy says no
        Value::Num(n) if *n == 0.0 => Some("Z".to_string()),
        _ => None,
    }
}

fn show_stamps(s: &Stamps) -> String {
    let mut v: Vec<String> = s
        .entries()
        .iter()
        .map(|(k, t)| format!("{k}={}", t - EPOCH))
        .collect();
    v.sort();
    v.join(",")
}

fn fmt_num(x: f64) -> String {
    dahonghua_core::num::js_num(x)
}

// ---------- the script ----------

fn parse_sections(arg: &str) -> Vec<(String, Option<i64>)> {
    arg.split(',')
        .filter(|s| !s.is_empty())
        .map(|part| match part.split_once('=') {
            // a stamp relative to the epoch, so a corpus line reads as an age
            Some((k, v)) => (k.to_string(), v.parse::<i64>().ok().map(|n| EPOCH + n)),
            None => (part.to_string(), None),
        })
        .collect()
}

fn run_line(line: &str) -> String {
    let mut sim = Sim::new();
    for cmd in line.split('|') {
        let (verb, arg) = match cmd.split_once(':') {
            Some((v, a)) => (v, a),
            None => (cmd, ""),
        };
        let parts: Vec<&str> = arg.split(',').collect();
        let num = |i: usize, d: f64| parts.get(i).and_then(|s| s.parse().ok()).unwrap_or(d);
        // A seed after sign-in would not be a seed: the store's root
        // subscription is live by then, so writing a row IS a local edit. The
        // two harnesses would diverge on it for a reason that has nothing to do
        // with the engine, which is the kind of harness fault that costs a day.
        if matches!(verb, "L" | "LF" | "R" | "P" | "FP" | "FC" | "FU" | "FQ")
            && sim.en.user().is_some()
        {
            panic!("{verb:?} is a seed and must come before the first I");
        }
        match verb {
            // seeds, before sign-in
            "L" => {
                let r = row(parts[0], num(1, 0.0), num(2, 1.0));
                sim.store.push(r);
            }
            "R" => {
                let r = row(parts[0], num(1, 0.0), num(2, 1.0));
                sim.server.entries.push(r);
            }
            "LF" => {
                let r = row_ft(parts[0], num(1, 0.0), true, num(2, 1000.0));
                sim.store.push(r);
            }
            "P" => sim.server.profile = Some(blob(&parse_sections(arg))),
            "FP" => sim.server.fail_pull = true,
            "FU" => sim.server.fail_push = true,
            "FQ" => sim.server.fail_config_push = true,
            "FC" => sim.server.fail_config_read = true,
            "OK" => {
                sim.server.fail_push = false;
                sim.server.fail_config_push = false;
            }
            // Turning failure back ON is what makes fail → succeed → fail
            // reachable, and that is the only sequence in which a success
            // resetting the backoff, or a second failure re-arming a pending
            // retry, is observable at all.
            "NG" => sim.server.fail_push = true,
            "NQ" => sim.server.fail_config_push = true,
            // the session
            "I" => {
                sim.send(Event::SignIn("u1".into()));
                sim.settle(1200);
            }
            "O" => {
                sim.send(Event::SignOut);
                sim.settle(1200);
            }
            // local activity
            "E" => {
                sim.config.insert(parts[0].to_string(), "L".to_string());
                sim.send(Event::LocalEdit {
                    sections: vec![parts[0].to_string()],
                    now: sim.now,
                });
            }
            "N" => {
                let r = row(parts[0], num(1, 0.0), num(2, 1.0));
                let id = row_id(&r);
                let before = sim.store.clone();
                match sim.store.iter().position(|x| row_id(x) == id) {
                    Some(i) => sim.store[i] = r,
                    None => sim.store.push(r),
                }
                // The store notifies on a change, not on a call. Writing a row
                // that is already exactly there is not an edit and must not be
                // reported as one — that is the platform's judgement to make,
                // and it is why the engine never sees this event.
                if sim.store != before {
                    sim.send(Event::LocalEdit {
                        sections: vec![],
                        now: sim.now,
                    });
                }
            }
            // Messages from the server, which only arrive on an open channel.
            "T" | "TF" | "TX" | "TZ" | "G" | "GX" if !sim.subscribed => {}
            "T" => sim.send(Event::RealtimeEntry(Some(row(
                parts[0],
                num(1, 0.0),
                num(2, 1.0),
            )))),
            "TF" => sim.send(Event::RealtimeEntry(Some(row_ft(
                parts[0],
                num(1, 0.0),
                false,
                num(2, 2000.0),
            )))),
            "TX" => sim.send(Event::RealtimeEntry(None)),
            // A payload that IS a row but carries no id. `!row.id` is truthy,
            // not a null check, so an empty string is as unusable as a missing
            // key — and `TX` never reaches that test, being refused one clause
            // earlier.
            "TZ" => sim.send(Event::RealtimeEntry(Some(row("", 1.0, 1.0)))),
            "G" => {
                let b = blob(&parse_sections(arg));
                sim.blob = Some(b.clone());
                sim.send(Event::RealtimeConfig(Some(b)));
            }
            "GX" => sim.send(Event::RealtimeConfig(Some(Value::Obj(vec![])))),
            "Y" => sim.send(Event::RetryNow),
            "S" => sim.settle(1200),
            // Three seconds: long enough for a 2s retry, short enough that a 4s
            // one is still pending. Without a window between them the backoff's
            // doubling is invisible to a 70-second settle.
            "S3" => sim.settle(3_000),
            // Sixty-two: past the 60s ceiling, short of the 64s an uncapped
            // backoff would have reached. The only window in which the cap is
            // observable at all.
            "S6" => sim.settle(62_000),
            "S9" => sim.settle(70_000),
            "" => {}
            other => panic!("unknown command {other:?}"),
        }
    }

    // The stamps are only observable in a profile upload, so the epilogue
    // forces one — otherwise a script that never pushed would compare nothing
    // about what it had decided.
    let ledger: Vec<String> = sim
        .store
        .iter()
        .map(|r| format!("{}@{}", row_id(r), fmt_num(updated_at(r))))
        .collect();
    let server: Vec<String> = {
        let mut v: Vec<String> = sim
            .server
            .entries
            .iter()
            .map(|r| format!("{}@{}", row_id(r), fmt_num(updated_at(r))))
            .collect();
        v.sort();
        v
    };
    let config: Vec<String> = sim.config.iter().map(|(k, v)| format!("{k}={v}")).collect();
    format!(
        "{} :: local={} server={} stamps={} config={} status={}",
        sim.log.join(" "),
        ledger.join(","),
        server.join(","),
        show_stamps(sim.en.stamps()),
        config.join(","),
        sim.last_status.as_str(),
    )
}

fn main() {
    let mut raw = String::new();
    std::io::stdin()
        .read_to_string(&mut raw)
        .expect("corpus on stdin");
    let mut out = String::new();
    for line in raw.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        out.push_str(&run_line(line));
        out.push('\n');
    }
    print!("{out}");
}
