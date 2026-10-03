//! What goes to a model and what comes back, as bytes.
//!
//! Any service speaking the OpenAI chat-completions shape: Xiaomi MiMo by
//! default, which is what the shipping app used, and whatever else a user
//! points it at. The platform sends these bodies and holds the key; which
//! words go in them, and how a reply is read, is decided here.
//!
//! What each request carries is the privacy statement, so it is worth reading
//! as one:
//!
//! * 一句话记账 — the sentence typed, today's date, and the category names
//!   (the user's own only when they allowed it).
//! * 拍小票 — the picture chosen, today's date, and the same names.
//! * 问账本 — the question, today's date, and the same names. **No row of the
//!   ledger is ever in a request**: the model writes a query and the query
//!   runs on the phone.

use crate::catalog::{all_cats, cat_name};
use crate::civil::Civil;
use crate::entry::Io;
use crate::jsval::{stringify, Value};

use super::quick::Custom;
use super::words::{iso, weekday_zh};

/// Token Plan keys (`tp-…`) are served by their own cluster; every other key
/// by the pay-as-you-go host. The shipping app's rule, kept.
pub fn default_base_url(key: &str) -> &'static str {
    if key.trim_start().starts_with("tp-") {
        "https://token-plan-cn.xiaomimimo.com/v1"
    } else {
        "https://api.xiaomimimo.com/v1"
    }
}

pub const DEFAULT_MODEL: &str = "mimo-v2.5-pro";
/// MiMo's multimodal model; the Pro one does not read pictures.
pub const DEFAULT_VISION_MODEL: &str = "mimo-v2.5";

/// MiMo takes a `thinking` switch and names the token cap
/// `max_completion_tokens`; most other compatible services reject an argument
/// they do not know and cap with `max_tokens`.
pub fn is_mimo(base_url: &str) -> bool {
    base_url.contains("xiaomimimo.com")
}

/// Where the chat goes: the base with `/chat/completions` on it, unless the
/// user pasted the whole endpoint already.
pub fn endpoint(base_url: &str) -> String {
    let b = base_url.trim().trim_end_matches('/');
    if b.ends_with("/chat/completions") {
        b.to_string()
    } else {
        format!("{b}/chat/completions")
    }
}

fn s(v: &str) -> Value {
    Value::Str(v.to_string())
}

fn obj(pairs: Vec<(&str, Value)>) -> Value {
    Value::Obj(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

fn body(model: &str, mimo: bool, system: &str, user: Value, cap: f64) -> String {
    let mut pairs = vec![
        ("model", s(model)),
        (
            "messages",
            Value::Arr(vec![
                obj(vec![("role", s("system")), ("content", s(system))]),
                obj(vec![("role", s("user")), ("content", user)]),
            ]),
        ),
        ("temperature", Value::Num(0.0)),
    ];
    if mimo {
        pairs.push(("max_completion_tokens", Value::Num(cap)));
        // An extraction, not a reasoning task. Left on, MiMo spends the
        // budget thinking and returns empty content — the shipping app's
        // finding: off is about two seconds and reliable JSON.
        pairs.push(("thinking", obj(vec![("type", s("disabled"))])));
    } else {
        pairs.push(("max_tokens", Value::Num(cap)));
    }
    stringify(&obj(pairs)).expect("an object always stringifies")
}

/// The category names a request may carry. The user's own only when they
/// allowed them to leave the phone: a custom category can be a name.
fn names(io: Io, custom: Custom, share: bool, zh: bool) -> String {
    let empty = Custom::default();
    let c = if share { custom } else { empty };
    all_cats(io, c.of(io))
        .iter()
        .map(|c| cat_name(c, zh))
        .collect::<Vec<_>>()
        .join("、")
}

fn context(today: Civil, custom: Custom, share: bool, zh: bool) -> String {
    format!(
        "Today: {} ({})\n支出分类 / expense categories: {}\n收入分类 / income categories: {}",
        iso(today),
        weekday_zh(today),
        names(Io::Exp, custom, share, zh),
        names(Io::Inc, custom, share, zh),
    )
}

const ENTRY_SHAPE: &str = r#"{"entries":[{"io":"exp"|"inc","amount":number,"category":"<one label from the lists>","note":"<short memo>","date":"YYYY-MM-DD"}]}"#;

pub const QUICK_SYSTEM: &str = "You read a short note from a personal bookkeeping app and turn it into the transactions it describes. \
One note may hold several: '午饭35 打车12' is two. \
Reply with ONLY a JSON object, no markdown, no explanation, of the form ENTRY_SHAPE. \
io is \"exp\" for money spent and \"inc\" for money received. \
amount is a positive number in the main currency, without a symbol; read Chinese numerals (三十五 = 35, 两千五 = 2500, 12块5 = 12.5). \
category MUST be exactly one label from the lists given, chosen by meaning. \
note is a short memo in the user's own words — the merchant, or what it was for — without the amount or the date; empty when there is nothing more. \
date only when the note says when (昨天, 前天, 上周三, 3天前, 9月21日), computed from today; leave it out otherwise, and never give a day after today. \
Never add a transaction that is not in the note. If there is none, reply {\"entries\":[]}.";

pub const RECEIPT_SYSTEM: &str = "You read a picture from a personal bookkeeping app: a receipt, an invoice, or a screenshot of a payment (微信支付, 支付宝, a bank app). \
A receipt or a payment result is ONE transaction — the total paid, never each line item. A screenshot of a list of payments may show several; list each. \
Reply with ONLY a JSON object, no markdown, no explanation, of the form ENTRY_SHAPE. \
io is \"exp\" for money paid and \"inc\" for money received or refunded. amount is the number actually paid, without a symbol. \
category MUST be exactly one label from the lists given. note is the merchant or payee, short. date is the transaction's date when the picture shows it. \
If the picture shows no transaction you can read, reply {\"entries\":[]}.";

pub const ASK_SYSTEM: &str = "You turn a question about the user's own bookkeeping into a query that the app runs on the phone. You never see the data and must not guess numbers. \
Reply with ONLY a JSON object, no markdown, of the form \
{\"period\":\"today|yesterday|this_week|last_week|this_month|last_month|this_year|last_year|last_n_days|all|custom\",\"n\":number,\"from\":\"YYYY-MM-DD\",\"to\":\"YYYY-MM-DD\",\"io\":\"exp|inc\",\"categories\":[\"<labels from the lists>\"],\"keyword\":\"<merchant or thing to match in notes, or empty>\",\"group\":\"none|category|day|month\",\"metric\":\"sum|count|avg_day|avg_entry|max\"}. \
n only for last_n_days; from and to only for custom. this_month and last_month mean the user's billing cycle, so prefer them to dates for 这个月 and 上个月. \
Defaults: period this_month, io exp, categories [], keyword \"\", group none, metric sum. \
Use categories when the question names a category or something that plainly belongs to one; use keyword for a merchant or a specific thing (外卖, 星巴克, 房租). \
group category for 'where did it go', day for 'each day', month for 'each month'. metric count for 几笔/几次, avg_day for 平均每天/日均, avg_entry for 平均每笔, max for 最贵/最大的一笔.";

/// The body for 一句话记账.
pub fn quick_body(
    model: &str,
    mimo: bool,
    text: &str,
    today: Civil,
    custom: Custom,
    share: bool,
    zh: bool,
) -> String {
    let system = QUICK_SYSTEM.replace("ENTRY_SHAPE", ENTRY_SHAPE);
    let user = format!(
        "{}\n\n记账 / note: {}",
        context(today, custom, share, zh),
        text.trim()
    );
    body(model, mimo, &system, s(&user), 800.0)
}

/// The body for 拍小票: the picture inline, as a data URL.
#[allow(clippy::too_many_arguments)]
pub fn receipt_body(
    model: &str,
    mimo: bool,
    image_base64: &str,
    mime: &str,
    today: Civil,
    custom: Custom,
    share: bool,
    zh: bool,
) -> String {
    let system = RECEIPT_SYSTEM.replace("ENTRY_SHAPE", ENTRY_SHAPE);
    let user = Value::Arr(vec![
        obj(vec![
            ("type", s("text")),
            (
                "text",
                s(&format!(
                    "{}\n\nRead this picture.",
                    context(today, custom, share, zh)
                )),
            ),
        ]),
        obj(vec![
            ("type", s("image_url")),
            (
                "image_url",
                obj(vec![(
                    "url",
                    s(&format!("data:{mime};base64,{image_base64}")),
                )]),
            ),
        ]),
    ]);
    body(model, mimo, &system, user, 1200.0)
}

/// The body for 问账本.
pub fn ask_body(
    model: &str,
    mimo: bool,
    question: &str,
    today: Civil,
    custom: Custom,
    share: bool,
    zh: bool,
) -> String {
    let user = format!(
        "{}\n\n问题 / question: {}",
        context(today, custom, share, zh),
        question.trim()
    );
    body(model, mimo, ASK_SYSTEM, s(&user), 300.0)
}

/// The smallest request that proves a key, a base and a model work together.
pub fn ping_body(model: &str, mimo: bool) -> String {
    body(
        model,
        mimo,
        "Reply with the single word OK.",
        s("ping"),
        5.0,
    )
}

/* --------------------------------------------------------------- replies -- */

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureKind {
    /// No connection, or no answer in time. The platform decides this one.
    Network,
    /// 401/403: the key is wrong, expired, or not for this service.
    Key,
    /// 402, or a quota message: the account has run out.
    Quota,
    /// 429.
    RateLimited,
    /// 400/404/422: usually a model name this service does not have.
    Request,
    /// 5xx.
    Server,
    /// 200, but nothing usable in it.
    Empty,
}

impl FailureKind {
    pub fn as_str(self) -> &'static str {
        match self {
            FailureKind::Network => "network",
            FailureKind::Key => "key",
            FailureKind::Quota => "quota",
            FailureKind::RateLimited => "rate",
            FailureKind::Request => "request",
            FailureKind::Server => "server",
            FailureKind::Empty => "empty",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Failure {
    pub kind: FailureKind,
    /// The service's own words, when it gave any — shown under ours, because
    /// "model not found: mimo-v3" says what ours cannot.
    pub detail: String,
}

fn error_message(v: &Value) -> String {
    match v.get("error") {
        Some(Value::Str(s)) => s.clone(),
        Some(e @ Value::Obj(_)) => match e.get("message") {
            Some(Value::Str(s)) => s.clone(),
            _ => String::new(),
        },
        _ => match v.get("message") {
            Some(Value::Str(s)) => s.clone(),
            _ => String::new(),
        },
    }
}

/// What the model said, or why there is nothing to read.
///
/// `status` and `body` are the HTTP response as it arrived.
pub fn reply_content(status: u16, body: &str) -> Result<String, Failure> {
    let v = crate::jsval::parse_checked(body.trim());
    let detail: String = v
        .as_ref()
        .map(error_message)
        .unwrap_or_default()
        .chars()
        .take(200)
        .collect();
    let fail = |kind| {
        Err(Failure {
            kind,
            detail: detail.clone(),
        })
    };
    match status {
        200..=299 => {}
        401 | 403 => return fail(FailureKind::Key),
        402 => return fail(FailureKind::Quota),
        429 => {
            let l = detail.to_lowercase();
            return if l.contains("quota") || l.contains("balance") || detail.contains("余额") {
                fail(FailureKind::Quota)
            } else {
                fail(FailureKind::RateLimited)
            };
        }
        500..=599 => return fail(FailureKind::Server),
        _ => return fail(FailureKind::Request),
    }
    let Some(v) = v else {
        return fail(FailureKind::Empty);
    };
    let content = match v.get("choices") {
        Some(Value::Arr(cs)) => cs
            .first()
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("content")),
        _ => None,
    };
    match content {
        Some(Value::Str(s)) if !s.trim().is_empty() => Ok(s.clone()),
        _ => fail(FailureKind::Empty),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jsval::parse_checked;

    fn today() -> Civil {
        Civil::new(2026, 8, 23)
    }

    #[test]
    fn the_key_picks_the_cluster() {
        assert_eq!(
            default_base_url("tp-abc"),
            "https://token-plan-cn.xiaomimimo.com/v1"
        );
        assert_eq!(default_base_url("sk-abc"), "https://api.xiaomimimo.com/v1");
        assert_eq!(
            endpoint("https://api.x.com/v1/"),
            "https://api.x.com/v1/chat/completions"
        );
        assert_eq!(
            endpoint("https://api.x.com/v1/chat/completions"),
            "https://api.x.com/v1/chat/completions"
        );
    }

    #[test]
    fn a_body_is_json_and_says_what_it_carries() {
        let b = quick_body(
            "m",
            true,
            "午饭35 \"打车\"12",
            today(),
            Custom::default(),
            true,
            true,
        );
        let v = parse_checked(&b).expect("the body is JSON");
        assert_eq!(v.get("model"), Some(&Value::Str("m".into())));
        let user = match v.get("messages") {
            Some(Value::Arr(m)) => m[1].get("content").cloned(),
            _ => None,
        };
        let Some(Value::Str(user)) = user else {
            panic!("a user message")
        };
        assert!(
            user.contains("2026-09-23 (周三)"),
            "today, and which day it is"
        );
        assert!(
            user.contains("餐饮") && user.contains("工资"),
            "both sides' names"
        );
        assert!(
            user.contains("午饭35 \"打车\"12"),
            "the sentence, quotes and all"
        );
        assert!(v.get("thinking").is_some() && v.get("max_completion_tokens").is_some());

        let other = quick_body("m", false, "x", today(), Custom::default(), true, true);
        let v = parse_checked(&other).unwrap();
        assert!(
            v.get("thinking").is_none(),
            "another service would refuse it"
        );
        assert!(v.get("max_tokens").is_some());
    }

    #[test]
    fn a_users_own_names_stay_home_unless_allowed() {
        let secret = crate::catalog::Category {
            k: "c1".into(),
            e: "🏥".into(),
            zh: "张医生诊所".into(),
            en: "".into(),
            c: "#000000".into(),
            custom: Some(true),
        };
        let mine = [secret];
        let custom = Custom {
            exp: &mine,
            inc: &[],
        };
        assert!(quick_body("m", true, "x", today(), custom, true, true).contains("张医生诊所"));
        assert!(!quick_body("m", true, "x", today(), custom, false, true).contains("张医生诊所"));
        assert!(!ask_body("m", true, "x", today(), custom, false, true).contains("张医生诊所"));
    }

    #[test]
    fn a_picture_goes_as_a_data_url() {
        let b = receipt_body(
            "v",
            true,
            "QUJD",
            "image/jpeg",
            today(),
            Custom::default(),
            true,
            true,
        );
        assert!(b.contains("data:image/jpeg;base64,QUJD"));
        assert!(parse_checked(&b).is_some());
    }

    #[test]
    fn a_reply_is_read_or_told_apart() {
        let ok = r#"{"choices":[{"message":{"role":"assistant","content":"{\"entries\":[]}"}}]}"#;
        assert_eq!(reply_content(200, ok), Ok("{\"entries\":[]}".into()));
        let k = |status, body| reply_content(status, body).unwrap_err().kind;
        assert_eq!(
            k(401, r#"{"error":{"message":"Invalid API key"}}"#),
            FailureKind::Key
        );
        assert_eq!(
            reply_content(401, r#"{"error":{"message":"Invalid API key"}}"#)
                .unwrap_err()
                .detail,
            "Invalid API key"
        );
        assert_eq!(
            k(429, r#"{"error":{"message":"rate limit"}}"#),
            FailureKind::RateLimited
        );
        assert_eq!(
            k(429, r#"{"error":{"message":"insufficient quota"}}"#),
            FailureKind::Quota
        );
        assert_eq!(k(402, ""), FailureKind::Quota);
        assert_eq!(
            k(404, r#"{"error":"model not found"}"#),
            FailureKind::Request
        );
        assert_eq!(k(503, "<html>"), FailureKind::Server);
        assert_eq!(
            k(200, r#"{"choices":[{"message":{"content":""}}]}"#),
            FailureKind::Empty,
            "thinking ate the budget"
        );
        assert_eq!(k(200, "not json"), FailureKind::Empty);
    }
}
