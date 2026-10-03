//! 一句话记账 — a sentence, into entries.
//!
//! The shipping app's `AIQuickEntry` read one entry out of a sentence, and only
//! with a network and a key. This reads as many as the sentence holds —
//! 午饭35 打车12，昨天超市128 is three — and reads them on the phone first:
//! amounts and days in [`super::words`], the category from what this user has
//! called things before and then from the keyword table. The model, when there
//! is one, is the better reader; this is the one that always answers.
//!
//! A model's reply comes back through [`parse_reply`], and it is untrusted
//! input: an amount it made up, a category it invented, a date in the future
//! and a reply wrapped in prose are all things a reply has been.

use std::collections::HashMap;
use std::sync::OnceLock;

use regex_lite::Regex;

use crate::catalog::{all_cats, Category};
use crate::civil::{parse_iso_date, Civil};
use crate::entry::{Entry, Io};
use crate::jsval::Value;
use crate::keywords::map_category;

use super::words::{amounts, clean_amount, cn_amounts_to_digits, half_width, take_day};

/// A user's own categories, both sides.
#[derive(Debug, Clone, Copy, Default)]
pub struct Custom<'a> {
    pub exp: &'a [Category],
    pub inc: &'a [Category],
}

impl<'a> Custom<'a> {
    pub fn of(&self, io: Io) -> &'a [Category] {
        if io == Io::Inc {
            self.inc
        } else {
            self.exp
        }
    }
}

/// One entry read out of a sentence, a picture or a reply, not yet saved.
#[derive(Debug, Clone, PartialEq)]
pub struct QuickDraft {
    pub io: Io,
    pub cat: String,
    pub amt: f64,
    pub note: String,
    /// The day it happened, when the words said. `None` is now.
    pub day: Option<Civil>,
}

/// The most a sentence or a picture is taken to hold. A reply listing more is
/// a model reading a statement line by line, and forty drafts is not a review
/// anybody does.
pub const MAX_DRAFTS: usize = 20;

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("pattern compiles"))
}

/// Money coming in, in the words people use for it.
fn inc_words() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(
        &R,
        "工资|薪水|薪资|发薪|奖金|年终|收到|收入|进账|到账|退款|返现|报销款|利息|分红|兼职|外快|赚|卖了|收款|收红包|红包收|转给我|还我|还钱给我",
    )
}

/// What is said around an amount and is not the note: the verbs of paying,
/// the currency words, and the particles.
fn filler() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(
        &R,
        r"花了|花费|花|用了|付了|付款|支付|交了|充了|吃了|喝了|买了|打了|一共|总共|共计|合计|共|大概|大约|约|差不多|左右|元|块钱|块|rmb|RMB|CNY|¥|￥|\$",
    )
}

/// What a sentence is cut into items at.
fn separators() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r"[，,、；;。！!？?\n]|还有|然后|另外|以及")
}

/// The note: the words left once the amount, the day and the fillers are out.
pub fn tidy_note(s: &str) -> String {
    let s = filler().replace_all(s, " ");
    let s = s
        .trim_matches(|c: char| c.is_whitespace() || "：:·-—~～的了和跟".contains(c))
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    s.chars().take(60).collect()
}

/// Supplementary words for things a sentence names and a bank's category label
/// never does. Checked only after the keyword table has had its say, so it
/// cannot change what bill import and notification capture decide.
const EXTRA: &[(&str, &[&str])] = &[
    (
        "food",
        &[
            "超市菜",
            "买菜",
            "菜市场",
            "肯德基",
            "麦当劳",
            "星巴克",
            "瑞幸",
            "喜茶",
            "蜜雪",
            "夜宵",
            "宵夜",
            "早点",
            "午饭",
            "晚饭",
            "早饭",
            "外卖",
            "饮料",
            "甜品",
            "蛋糕",
            "面包",
            "酒",
        ],
    ),
    (
        "shop",
        &[
            "超市",
            "便利店",
            "衣服",
            "鞋",
            "裤",
            "包包",
            "洗发",
            "牙膏",
            "纸巾",
            "日用品",
            "手机",
            "电脑",
            "耳机",
        ],
    ),
    (
        "trans",
        &[
            "油费",
            "高速",
            "过路",
            "机场",
            "车票",
            "船票",
            "骑车",
            "哈啰",
            "美团单车",
        ],
    ),
    ("home", &["电费", "水费", "网费", "暖气", "维修", "房东"]),
    (
        "fun",
        &[
            "健身",
            "游泳",
            "唱歌",
            "网吧",
            "剧本杀",
            "门票",
            "爱奇艺",
            "腾讯视频",
            "优酷",
            "B站",
            "网易云",
            "Steam",
        ],
    ),
    ("health", &["看病", "感冒", "口罩", "眼镜", "牙医"]),
];

/// Which category a note is, by what this user has called the same thing
/// before, then by the keyword table, then by the words above.
///
/// The user's own history wins because it is the only source that knows this
/// user: somebody who files 瑞幸 under 咖啡, their own category, should get
/// 咖啡 back, not the table's 餐饮. A past note matches when either contains
/// the other; the longest match wins, and among equals the category used most.
pub fn guess_category(note: &str, io: Io, history: &[&Entry], custom: Custom) -> String {
    let cats = all_cats(io, custom.of(io));
    let known = |k: &str| cats.iter().any(|c| c.k == k);
    let n = note.trim();
    if n.chars().count() >= 2 {
        let mut best: HashMap<&str, (usize, usize)> = HashMap::new();
        for e in history {
            if e.io.unwrap_or(Io::Exp) != io || e.deleted_at.is_some_and(|d| d != 0) {
                continue;
            }
            let Some(past) = e
                .note
                .as_deref()
                .map(str::trim)
                .filter(|p| p.chars().count() >= 2)
            else {
                continue;
            };
            if !(n.contains(past) || past.contains(n)) || !known(&e.cat) {
                continue;
            }
            let len = past.chars().count().min(n.chars().count());
            let slot = best.entry(e.cat.as_str()).or_insert((0, 0));
            slot.0 = slot.0.max(len);
            slot.1 += 1;
        }
        if let Some((cat, _)) = best
            .iter()
            .max_by(|a, b| a.1.cmp(b.1).then_with(|| b.0.cmp(a.0)))
        {
            return (*cat).to_string();
        }
    }

    let by_table = map_category(io, None, Some(n), custom.of(io));
    if by_table != "other" {
        return by_table;
    }
    if io == Io::Exp {
        for (key, words) in EXTRA {
            if words.iter().any(|w| n.contains(w)) && known(key) {
                return key.to_string();
            }
        }
    }
    "other".to_string()
}

fn direction(text: &str) -> Io {
    // 发红包 is money going out, whatever 红包 says elsewhere
    if text.contains("发红包") || text.contains("给红包") {
        return Io::Exp;
    }
    if inc_words().is_match(text) {
        Io::Inc
    } else {
        Io::Exp
    }
}

/// Read every entry in a sentence, on the phone.
///
/// The sentence is cut at punctuation and at 还有/然后; a piece holding two
/// amounts with nothing between them — 午饭35打车12 — is cut again, each
/// amount taking the words before it, or after it when the piece starts with
/// the number (35午饭). A day said once holds for what follows until another is
/// said: 昨天午饭35，打车12 is two entries from yesterday.
pub fn parse_offline(
    text: &str,
    today: Civil,
    history: &[&Entry],
    custom: Custom,
) -> Vec<QuickDraft> {
    let text = cn_amounts_to_digits(&half_width(text));
    let mut out = Vec::new();
    let mut day: Option<Civil> = None;

    for piece in separators().split(&text) {
        let (rest, said) = take_day(piece, today);
        if said.is_some() {
            day = said;
        }
        let found = amounts(&rest);
        if found.is_empty() {
            continue;
        }
        // Words before the first number: the labels come before their
        // amounts. None: they come after (35午饭 12打车).
        let lead = tidy_note(&rest[..found[0].start]);
        let after = lead.is_empty();
        for (i, f) in found.iter().enumerate() {
            let label = if after {
                let end = found.get(i + 1).map_or(rest.len(), |n| n.start);
                &rest[f.end..end]
            } else {
                let start = if i == 0 { 0 } else { found[i - 1].end };
                &rest[start..f.start]
            };
            let note = tidy_note(label);
            let io = direction(label);
            out.push(QuickDraft {
                io,
                cat: guess_category(&note, io, history, custom),
                amt: f.amount,
                note,
                day,
            });
            if out.len() == MAX_DRAFTS {
                return out;
            }
        }
    }
    out
}

/* ------------------------------------------------------ a model's reply -- */

/// Why a reply could not be used.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplyError {
    /// Not JSON, or JSON of no shape this reads.
    Unreadable,
}

/// The JSON a model put in its reply, wherever it put it: bare, fenced in
/// ```json, or with a sentence either side.
pub fn extract_json(content: &str) -> Option<Value> {
    let s = content.trim();
    let s = match (s.find("```"), s.rfind("```")) {
        (Some(a), Some(b)) if b > a => {
            let inner = &s[a + 3..b];
            inner.strip_prefix("json").unwrap_or(inner).trim()
        }
        _ => s,
    };
    let open = s.find(['{', '['])?;
    let close = s.rfind(['}', ']'])?;
    if close <= open {
        return None;
    }
    crate::jsval::parse_checked(&s[open..=close])
}

/// A number or a numeric string: models write `"35"`, `"¥35"` and `"35.00"`
/// as often as `35`.
pub fn number_in(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Num(n) => Some(*n),
        Value::Str(s) => {
            let t: String = half_width(s)
                .chars()
                .filter(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
                .collect();
            t.parse().ok()
        }
        _ => None,
    }
}

pub fn text_in(v: Option<&Value>) -> String {
    match v {
        Some(Value::Str(s)) => s.trim().to_string(),
        _ => String::new(),
    }
}

/// A label a model chose, resolved to one of this user's category keys: the
/// exact name in either language or the emoji, then a name one contains the
/// other. `None` when it names nothing that exists.
pub fn resolve_category(label: &str, io: Io, custom: Custom) -> Option<String> {
    let q = label.trim();
    if q.is_empty() {
        return None;
    }
    let lower = q.to_lowercase();
    let cats = all_cats(io, custom.of(io));
    if let Some(c) = cats
        .iter()
        .find(|c| c.zh == q || c.en.to_lowercase() == lower || c.e == q || c.k == q)
    {
        return Some(c.k.clone());
    }
    cats.iter()
        .find(|c| {
            (!c.zh.is_empty() && (c.zh.contains(q) || q.contains(c.zh.as_str())))
                || (!c.en.is_empty() && lower.contains(&c.en.to_lowercase()))
        })
        .map(|c| c.k.clone())
}

fn io_in(v: Option<&Value>) -> Io {
    match text_in(v).to_lowercase().as_str() {
        "inc" | "income" | "收入" | "in" => Io::Inc,
        _ => Io::Exp,
    }
}

/// One entry object from a reply, checked.
fn draft_of(v: &Value, today: Civil, history: &[&Entry], custom: Custom) -> Option<QuickDraft> {
    let io = io_in(v.get("io"));
    let amt = clean_amount(number_in(v.get("amount"))?)?;
    let note: String = text_in(v.get("note")).chars().take(60).collect();
    let cat = resolve_category(&text_in(v.get("category")), io, custom)
        .unwrap_or_else(|| guess_category(&note, io, history, custom));
    // a day the model named, if it is a real one and not ahead of today
    let day = parse_iso_date(&text_in(v.get("date"))).filter(|d| *d <= today);
    Some(QuickDraft {
        io,
        cat,
        amt,
        note,
        day,
    })
}

/// A model's reply, as drafts. `{"entries":[…]}`, a bare array, or a single
/// entry object all read; an entry without a usable amount is dropped rather
/// than kept at zero. An empty list is a valid answer — the model found
/// nothing — and is not an error.
pub fn parse_reply(
    content: &str,
    today: Civil,
    history: &[&Entry],
    custom: Custom,
) -> Result<Vec<QuickDraft>, ReplyError> {
    let v = extract_json(content).ok_or(ReplyError::Unreadable)?;
    let items: Vec<&Value> = match &v {
        Value::Arr(a) => a.iter().collect(),
        Value::Obj(_) => match v.get("entries") {
            Some(Value::Arr(a)) => a.iter().collect(),
            Some(_) => return Err(ReplyError::Unreadable),
            None if v.get("amount").is_some() => vec![&v],
            None => return Err(ReplyError::Unreadable),
        },
        _ => return Err(ReplyError::Unreadable),
    };
    Ok(items
        .into_iter()
        .filter_map(|i| draft_of(i, today, history, custom))
        .take(MAX_DRAFTS)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn today() -> Civil {
        Civil::new(2026, 8, 23) // Wednesday 23 September 2026
    }

    fn read(s: &str) -> Vec<QuickDraft> {
        parse_offline(s, today(), &[], Custom::default())
    }

    fn brief(d: &[QuickDraft]) -> Vec<(String, f64, String)> {
        d.iter()
            .map(|d| (d.cat.clone(), d.amt, d.note.clone()))
            .collect()
    }

    #[test]
    fn one_entry() {
        let d = read("午饭35");
        assert_eq!(brief(&d), vec![("food".into(), 35.0, "午饭".into())]);
        assert_eq!(d[0].io, Io::Exp);
        assert_eq!(d[0].day, None, "no day said: now");
    }

    #[test]
    fn several_in_one_sentence() {
        let d = read("午饭35 打车12，超市买水果28.5");
        assert_eq!(
            brief(&d),
            vec![
                ("food".into(), 35.0, "午饭".into()),
                ("trans".into(), 12.0, "打车".into()),
                ("food".into(), 28.5, "超市买水果".into()),
            ]
        );
    }

    #[test]
    fn run_together_with_no_separator() {
        assert_eq!(read("午饭35打车12").len(), 2);
        let d = read("35午饭 12打车");
        assert_eq!(
            brief(&d),
            vec![
                ("food".into(), 35.0, "午饭".into()),
                ("trans".into(), 12.0, "打车".into())
            ],
            "the number first, the words after"
        );
    }

    #[test]
    fn said_aloud_in_chinese_numbers() {
        let d = read("午饭三十五，打车十二块五");
        assert_eq!(
            d.iter().map(|d| d.amt).collect::<Vec<_>>(),
            vec![35.0, 12.5]
        );
    }

    #[test]
    fn the_verbs_of_paying_are_not_the_note() {
        let d = read("昨天吃火锅花了268元");
        assert_eq!(d[0].note, "吃火锅");
        assert_eq!(d[0].amt, 268.0);
        assert_eq!(d[0].day, Some(Civil::new(2026, 8, 22)));
    }

    #[test]
    fn a_day_holds_until_another_is_said() {
        let d = read("昨天午饭35，打车12；今天咖啡18");
        let y = Some(Civil::new(2026, 8, 22));
        assert_eq!(
            d.iter().map(|d| d.day).collect::<Vec<_>>(),
            vec![y, y, Some(today())]
        );
    }

    #[test]
    fn income_is_told_from_spending() {
        let d = read("发工资8000，发红包200");
        assert_eq!(d[0].io, Io::Inc);
        assert_eq!(d[0].cat, "salary");
        assert_eq!(d[1].io, Io::Exp, "a red packet given is money out");
        let d = read("退款32");
        assert_eq!(d[0].io, Io::Inc);
    }

    #[test]
    fn counts_are_not_amounts() {
        let d = read("咖啡2杯36");
        assert_eq!(brief(&d), vec![("food".into(), 36.0, "咖啡2杯".into())]);
    }

    #[test]
    fn nothing_to_read_is_nothing() {
        assert!(read("今天天气不错").is_empty());
        assert!(read("").is_empty());
    }

    #[test]
    fn the_users_own_words_beat_the_table() {
        let coffee = Category {
            k: "c_coffee".into(),
            e: "☕".into(),
            zh: "咖啡".into(),
            en: "Coffee".into(),
            c: "#886644".into(),
            custom: Some(true),
        };
        let past = Entry {
            io: Some(Io::Exp),
            cat: "c_coffee".into(),
            amt: 18.0,
            note: Some("瑞幸".into()),
            ..Default::default()
        };
        let custom = [coffee];
        let c = Custom {
            exp: &custom,
            inc: &[],
        };
        let d = parse_offline("瑞幸拿铁19", today(), &[&past], c);
        assert_eq!(d[0].cat, "c_coffee", "瑞幸 has been 咖啡 before");
        // and without the history, the table
        let d = parse_offline("瑞幸拿铁19", today(), &[], c);
        assert_eq!(d[0].cat, "food");
    }

    #[test]
    fn the_extra_words_only_speak_after_the_table() {
        assert_eq!(read("超市128")[0].cat, "shop");
        assert_eq!(read("健身卡300")[0].cat, "fun");
    }

    #[test]
    fn a_reply_in_any_of_its_shapes() {
        let t = today();
        let r = |s: &str| parse_reply(s, t, &[], Custom::default());
        let two = r(r#"{"entries":[{"io":"exp","amount":35,"category":"餐饮","note":"午饭"},{"io":"exp","amount":"12","category":"交通","note":"打车","date":"2026-09-22"}]}"#)
            .unwrap();
        assert_eq!(
            brief(&two),
            vec![
                ("food".into(), 35.0, "午饭".into()),
                ("trans".into(), 12.0, "打车".into())
            ]
        );
        assert_eq!(two[1].day, Some(Civil::new(2026, 8, 22)));

        let fenced = r("好的：\n```json\n{\"entries\":[{\"io\":\"inc\",\"amount\":\"¥8,000\",\"category\":\"工资\"}]}\n```").unwrap();
        assert_eq!(fenced[0].io, Io::Inc);
        assert_eq!(fenced[0].cat, "salary");

        let single = r(r#"{"io":"exp","amount":4.5,"category":"Food"}"#).unwrap();
        assert_eq!(single[0].cat, "food", "an English label resolves too");

        let bare = r(r#"[{"io":"exp","amount":20,"category":"🍜"}]"#).unwrap();
        assert_eq!(bare[0].cat, "food", "and an emoji");
    }

    #[test]
    fn a_reply_is_untrusted() {
        let t = today();
        let r = |s: &str| parse_reply(s, t, &[], Custom::default());
        let d = r(r#"{"entries":[{"amount":0},{"amount":-5},{"amount":1e15},{"amount":"abc"},{"amount":9,"category":"不存在的分类","note":"打车"},{"amount":7,"date":"2026-12-25"}]}"#).unwrap();
        assert_eq!(
            d.len(),
            2,
            "no zero, negative, absurd or unreadable amounts"
        );
        assert_eq!(
            d[0].cat, "trans",
            "an invented label falls back to the note"
        );
        assert_eq!(d[1].day, None, "a day in the future is not kept");
        assert_eq!(
            r(r#"{"entries":[]}"#).unwrap(),
            vec![],
            "nothing found is an answer"
        );
        assert_eq!(r("I can't help with that."), Err(ReplyError::Unreadable));
        assert_eq!(r(r#"{"total": 5}"#), Err(ReplyError::Unreadable));
    }

    #[test]
    fn a_reply_is_capped() {
        let many: Vec<String> = (1..=30).map(|i| format!(r#"{{"amount":{i}}}"#)).collect();
        let s = format!(r#"{{"entries":[{}]}}"#, many.join(","));
        let d = parse_reply(&s, today(), &[], Custom::default()).unwrap();
        assert_eq!(d.len(), MAX_DRAFTS);
    }
}
