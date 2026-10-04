//! 智能记账, across the boundary.
//!
//! Dart holds the key and sends the bytes; everything else is here or in
//! `core::ai`. The flow is the same for all three features: ask for an
//! [`AiRequest`], send it, hand the status and the body back, and get drafts or
//! a query that the core has already checked.
//!
//! The settings live in the config under `ai`, like the theme: a device's
//! choice, which goes into its backups. **The key does not**: it is kept by
//! the platform's encrypted store, and nothing on this side ever sees it except
//! [`ai_default_base_url`], which reads its first three characters to pick the
//! cluster a Token Plan key belongs to.

use std::sync::{Mutex, MutexGuard, OnceLock};

use dahonghua_core::ai::ask::{self, AskQuery, AskRow, Group, Metric};
use dahonghua_core::ai::quick::{self, Custom, QuickDraft};
use dahonghua_core::ai::wire::{self, Failure};
use dahonghua_core::ai::words;
use dahonghua_core::catalog::{cat_name, cat_of};
use dahonghua_core::civil::Civil;
use dahonghua_core::entry::{Entry, Io};
use dahonghua_core::jsval::Value;
use flutter_rust_bridge::frb;

use super::store::{by_id, settings_of, store};

/* -------------------------------------------------------------- settings -- */

#[derive(Debug, Clone, PartialEq, Default)]
pub struct AiSettingsView {
    /// Off until the user turns it on. Off, nothing is sent anywhere, and
    /// 一句话记账 and 问账本 still work — on the phone.
    pub enabled: bool,
    /// Empty: the default for the key — see [`ai_default_base_url`].
    pub base_url: String,
    /// Empty: `mimo-v2.5-pro`.
    pub model: String,
    /// Empty: `mimo-v2.5`, the one that reads pictures.
    pub vision_model: String,
}

fn settings_lock() -> MutexGuard<'static, AiSettingsView> {
    static S: OnceLock<Mutex<AiSettingsView>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(AiSettingsView::default()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

#[frb(sync)]
pub fn ai_settings() -> AiSettingsView {
    settings_lock().clone()
}

/// Save the settings. The save notices on its own — see `db::flush_store`.
#[frb(sync)]
pub fn set_ai_settings(view: AiSettingsView) {
    let clean = |s: String| s.trim().to_string();
    *settings_lock() = AiSettingsView {
        enabled: view.enabled,
        base_url: clean(view.base_url),
        model: clean(view.model),
        vision_model: clean(view.vision_model),
    };
}

/// The base URL a key is served from when none is set: Token Plan keys
/// (`tp-`) have their own cluster. Only the prefix is needed.
#[frb(sync)]
pub fn ai_default_base_url(key_prefix: String) -> String {
    wire::default_base_url(&key_prefix).to_string()
}

#[frb(sync)]
pub fn ai_default_model() -> String {
    wire::DEFAULT_MODEL.to_string()
}

#[frb(sync)]
pub fn ai_default_vision_model() -> String {
    wire::DEFAULT_VISION_MODEL.to_string()
}

pub(crate) fn settings_value() -> Value {
    let s = ai_settings();
    Value::Obj(vec![
        ("enabled".into(), Value::Bool(s.enabled)),
        ("base".into(), Value::Str(s.base_url)),
        ("model".into(), Value::Str(s.model)),
        ("vision".into(), Value::Str(s.vision_model)),
    ])
}

pub(crate) fn load_settings(v: Option<&Value>) {
    let text = |k: &str| match v.and_then(|v| v.get(k)) {
        Some(Value::Str(s)) => s.clone(),
        _ => String::new(),
    };
    set_ai_settings(AiSettingsView {
        enabled: matches!(v.and_then(|v| v.get("enabled")), Some(Value::Bool(true))),
        base_url: text("base"),
        model: text("model"),
        vision_model: text("vision"),
    });
}

pub(crate) fn reset_settings() {
    set_ai_settings(AiSettingsView::default());
}

/* --------------------------------------------------------------- requests -- */

/// One request for the platform to send: where, what, and how long to wait.
/// The key goes in the `Authorization` header, added by the platform.
#[derive(Debug, Clone, PartialEq)]
pub struct AiRequest {
    pub url: String,
    pub body: String,
    pub timeout_secs: u32,
}

fn parse_day(s: &str) -> Civil {
    let mut it = s.split('-');
    let y = it.next().and_then(|v| v.parse().ok()).unwrap_or(1970);
    let m: i32 = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    let d = it.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    Civil::new(y, m - 1, d)
}

fn show_day(d: Civil) -> String {
    format!("{}-{}-{}", d.y, d.m + 1, d.d)
}

/// The port has no user-defined categories yet, so there is nothing of the
/// user's own to send or to hold back. When it has, they go here — and
/// `wire` already sends them only when allowed.
fn custom() -> Custom<'static> {
    Custom::default()
}

struct Resolved {
    url: String,
    model: String,
    vision: String,
    mimo: bool,
}

fn resolved(key_prefix: &str) -> Resolved {
    let s = ai_settings();
    let base = if s.base_url.is_empty() {
        wire::default_base_url(key_prefix).to_string()
    } else {
        s.base_url
    };
    Resolved {
        url: wire::endpoint(&base),
        mimo: wire::is_mimo(&base),
        model: if s.model.is_empty() {
            wire::DEFAULT_MODEL.into()
        } else {
            s.model
        },
        vision: if s.vision_model.is_empty() {
            wire::DEFAULT_VISION_MODEL.into()
        } else {
            s.vision_model
        },
    }
}

/// 一句话记账's request. `key_prefix` is the key's first three characters, for
/// the default base only.
#[frb(sync)]
pub fn quick_request(text: String, today: String, zh: bool, key_prefix: String) -> AiRequest {
    let r = resolved(&key_prefix);
    AiRequest {
        body: wire::quick_body(
            &r.model,
            r.mimo,
            &text,
            parse_day(&today),
            custom(),
            false,
            zh,
        ),
        url: r.url,
        timeout_secs: 25,
    }
}

/// 拍小票's request. The picture arrives already shrunk by the platform.
#[frb(sync)]
pub fn receipt_request(
    image_base64: String,
    mime: String,
    today: String,
    zh: bool,
    key_prefix: String,
) -> AiRequest {
    let r = resolved(&key_prefix);
    AiRequest {
        body: wire::receipt_body(
            &r.vision,
            r.mimo,
            &image_base64,
            &mime,
            parse_day(&today),
            custom(),
            false,
            zh,
        ),
        url: r.url,
        // a picture takes longer to read
        timeout_secs: 45,
    }
}

/// 问账本's request: the question, and nothing of the ledger.
#[frb(sync)]
pub fn ask_request(question: String, today: String, zh: bool, key_prefix: String) -> AiRequest {
    let r = resolved(&key_prefix);
    AiRequest {
        body: wire::ask_body(
            &r.model,
            r.mimo,
            &question,
            parse_day(&today),
            custom(),
            false,
            zh,
        ),
        url: r.url,
        timeout_secs: 25,
    }
}

/// The smallest request that proves the key, the base and the model work.
#[frb(sync)]
pub fn ping_request(key_prefix: String) -> AiRequest {
    let r = resolved(&key_prefix);
    AiRequest {
        body: wire::ping_body(&r.model, r.mimo),
        url: r.url,
        timeout_secs: 20,
    }
}

/* ---------------------------------------------------------------- replies -- */

/// Why nothing usable came back. `kind` is `network`, `key`, `quota`, `rate`,
/// `request`, `server`, `empty` or `unreadable`; the words for each are Dart's.
#[derive(Debug, Clone, PartialEq)]
pub struct FailureView {
    pub kind: String,
    /// The service's own message, when it gave one.
    pub detail: String,
}

fn failure_view(f: Failure) -> FailureView {
    FailureView {
        kind: f.kind.as_str().to_string(),
        detail: f.detail,
    }
}

/// One entry, ready to show and to save.
#[derive(Debug, Clone, PartialEq)]
pub struct DraftView {
    pub io: String,
    pub cat: String,
    pub amt: f64,
    pub note: String,
    /// `y-m-d`, when the words named a day; `None` is now.
    pub day: Option<String>,
    pub emoji: String,
    pub name: String,
    pub color: String,
}

fn draft_view(d: QuickDraft, zh: bool) -> DraftView {
    let c = cat_of(d.io, &d.cat, custom().of(d.io));
    DraftView {
        io: d.io.as_str().to_string(),
        cat: d.cat,
        amt: d.amt,
        note: d.note,
        day: d.day.map(show_day),
        emoji: c.e.clone(),
        name: cat_name(&c, zh),
        color: c.c.clone(),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DraftsView {
    pub drafts: Vec<DraftView>,
    pub failure: Option<FailureView>,
}

fn live_history(s: &dahonghua_core::store::Store) -> Vec<&Entry> {
    s.ledger.live().collect()
}

/// 一句话记账, on the phone: no request, no key.
#[frb(sync)]
pub fn quick_offline(text: String, today: String, zh: bool) -> Vec<DraftView> {
    let s = store();
    let history = live_history(&s);
    quick::parse_offline(&text, parse_day(&today), &history, custom())
        .into_iter()
        .map(|d| draft_view(d, zh))
        .collect()
}

/// A reply to 一句话记账 or 拍小票, as drafts. An empty list with no failure is
/// the model finding nothing, which is an answer.
#[frb(sync)]
pub fn drafts_reply(status: u16, body: String, today: String, zh: bool) -> DraftsView {
    let content = match wire::reply_content(status, &body) {
        Ok(c) => c,
        Err(f) => {
            return DraftsView {
                drafts: Vec::new(),
                failure: Some(failure_view(f)),
            }
        }
    };
    let s = store();
    let history = live_history(&s);
    match quick::parse_reply(&content, parse_day(&today), &history, custom()) {
        Ok(ds) => DraftsView {
            drafts: ds.into_iter().map(|d| draft_view(d, zh)).collect(),
            failure: None,
        },
        Err(_) => DraftsView {
            drafts: Vec::new(),
            failure: Some(FailureView {
                kind: "unreadable".into(),
                detail: content.chars().take(120).collect(),
            }),
        },
    }
}

/// A reply to the ping: `None` is working.
#[frb(sync)]
pub fn ping_reply(status: u16, body: String) -> Option<FailureView> {
    wire::reply_content(status, &body).err().map(failure_view)
}

/// A failure the platform saw before any reply: no connection, or no answer
/// in time.
#[frb(sync)]
pub fn network_failure() -> FailureView {
    FailureView {
        kind: wire::FailureKind::Network.as_str().into(),
        detail: String::new(),
    }
}

/* -------------------------------------------------------------------- ask -- */

#[derive(Debug, Clone, PartialEq)]
pub struct AskQueryView {
    /// `y-m-d`, inclusive both ends.
    pub from: String,
    pub to: String,
    pub io: String,
    pub cats: Vec<String>,
    pub keyword: String,
    /// `none`, `category`, `day` or `month`.
    pub group: String,
    /// `sum`, `count`, `avg_day`, `avg_entry` or `max`.
    pub metric: String,
}

fn query_view(q: &AskQuery) -> AskQueryView {
    AskQueryView {
        from: show_day(q.from),
        to: show_day(q.to),
        io: q.io.as_str().to_string(),
        cats: q.cats.clone(),
        keyword: q.keyword.clone(),
        group: q.group.as_str().to_string(),
        metric: q.metric.as_str().to_string(),
    }
}

fn query_of(v: &AskQueryView) -> AskQuery {
    AskQuery {
        from: parse_day(&v.from),
        to: parse_day(&v.to),
        io: if v.io == "inc" { Io::Inc } else { Io::Exp },
        cats: v.cats.clone(),
        keyword: v.keyword.clone(),
        group: match v.group.as_str() {
            "category" => Group::Category,
            "day" => Group::Day,
            "month" => Group::Month,
            _ => Group::None,
        },
        metric: match v.metric.as_str() {
            "count" => Metric::Count,
            "avg_day" => Metric::AvgDay,
            "avg_entry" => Metric::AvgEntry,
            "max" => Metric::Max,
            _ => Metric::Sum,
        },
    }
}

/// 问账本, on the phone.
#[frb(sync)]
pub fn ask_offline(question: String, today: String) -> AskQueryView {
    let q = ask::parse_offline(
        &question,
        parse_day(&today),
        settings_of().cycle_start,
        custom(),
    );
    query_view(&q)
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskReplyView {
    pub query: Option<AskQueryView>,
    pub failure: Option<FailureView>,
}

/// A reply to 问账本's request, as a query checked here.
#[frb(sync)]
pub fn ask_reply(status: u16, body: String, today: String) -> AskReplyView {
    match wire::reply_content(status, &body) {
        Err(f) => AskReplyView {
            query: None,
            failure: Some(failure_view(f)),
        },
        Ok(content) => match ask::parse_reply(
            &content,
            parse_day(&today),
            settings_of().cycle_start,
            custom(),
        ) {
            Some(q) => AskReplyView {
                query: Some(query_view(&q)),
                failure: None,
            },
            None => AskReplyView {
                query: None,
                failure: Some(FailureView {
                    kind: "unreadable".into(),
                    detail: content.chars().take(120).collect(),
                }),
            },
        },
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskGroupView {
    /// A category key, `y-m-d` or `y-m`.
    pub key: String,
    /// The category's name, for a category group; the key otherwise.
    pub label: String,
    pub emoji: String,
    pub color: String,
    pub amount: f64,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskRowView {
    pub id: String,
    pub emoji: String,
    pub name: String,
    pub note: String,
    pub amt: f64,
    pub day: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskAnswerView {
    /// As run: a keyword that matched nothing may have become its category.
    pub query: AskQueryView,
    /// The names of the query's categories, for the chips.
    pub cat_names: Vec<String>,
    pub value: f64,
    pub total: f64,
    pub count: u32,
    pub days: u32,
    pub side_total: f64,
    pub share: Option<f64>,
    pub groups: Vec<AskGroupView>,
    pub top: Vec<AskRowView>,
    pub fell_back: bool,
}

/// Run a query over the ledger. `ids` and `days_of` are every live entry and
/// its day in this device's zone — the day is the platform's to decide.
#[frb(sync)]
pub fn ask_run(
    query: AskQueryView,
    ids: Vec<String>,
    days_of: Vec<String>,
    today: String,
    zh: bool,
) -> AskAnswerView {
    let s = store();
    let map = by_id(&s);
    let rows: Vec<AskRow> = ids
        .iter()
        .zip(days_of.iter())
        .filter_map(|(id, day)| {
            map.get(id.as_str()).map(|e| AskRow {
                entry: e,
                day: parse_day(day),
            })
        })
        .collect();
    let q = query_of(&query);
    let a = ask::run(&q, &rows, parse_day(&today), custom(), zh);
    let io = a.query.io;
    let cat = |k: &str| cat_of(io, k, custom().of(io));
    AskAnswerView {
        cat_names: a.query.cats.iter().map(|k| cat_name(&cat(k), zh)).collect(),
        query: query_view(&a.query),
        value: a.value,
        total: a.total,
        count: a.count as u32,
        days: a.days.max(0) as u32,
        side_total: a.side_total,
        share: a.share,
        groups: a
            .groups
            .iter()
            .map(|g| {
                let (label, emoji, color) = if a.query.group == Group::Category {
                    let c = cat(&g.key);
                    (cat_name(&c, zh), c.e.clone(), c.c.clone())
                } else {
                    (g.key.clone(), String::new(), String::new())
                };
                AskGroupView {
                    key: g.key.clone(),
                    label,
                    emoji,
                    color,
                    amount: g.amount,
                    count: g.count as u32,
                }
            })
            .collect(),
        top: a
            .top
            .iter()
            .filter_map(|id| map.get(id.as_str()))
            .map(|e| {
                let c = cat(&e.cat);
                let day = rows
                    .iter()
                    .find(|r| r.entry.id == e.id)
                    .map(|r| show_day(r.day))
                    .unwrap_or_default();
                AskRowView {
                    id: e.id.clone(),
                    emoji: c.e.clone(),
                    name: cat_name(&c, zh),
                    note: e.note.clone().unwrap_or_default(),
                    amt: e.amt,
                    day,
                }
            })
            .collect(),
        fell_back: a.fell_back,
    }
}

/// `y-m-d`, zero-padded — for a test to compare with what a model is told.
#[frb(sync)]
pub fn iso_day(day: String) -> String {
    words::iso(parse_day(&day))
}
