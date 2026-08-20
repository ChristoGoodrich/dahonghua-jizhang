//! Turning parsed bills into import-ready candidates, and spotting the ones
//! already in the ledger.
//!
//! Ported from `src/domain/billDedup.ts`.
//!
//! The dedup needs each existing entry's *calendar day*, which an epoch
//! millisecond does not yield without a timezone — the boundary `civil.rs`
//! draws. So the caller hands over a projection rather than the entries
//! themselves: [`existing_row`] builds one from an [`Entry`] plus the day the
//! platform resolved it to, and keeps the filtering rules on this side where
//! the parity corpus can reach them.

use crate::bills::{CivilTime, RawBill};
use crate::catalog::{all_cats, Category};
use crate::civil::Civil;
use crate::entry::{Entry, EntrySource, Io};
use crate::num::to_fixed;
use std::collections::HashMap;

/// An import-ready candidate: an entry-shaped payload plus preview metadata.
#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    pub io: Io,
    /// Resolved category key.
    pub cat: String,
    pub amt: f64,
    pub note: String,
    pub at: CivilTime,
    /// Already present in the ledger, and so skipped by default.
    pub dup: bool,
}

/* ------------------------------------------------------ category mapping -- */

// Substring keyword to category key, scoped by direction. First match wins.
const EXP_KEYWORDS: &[(&str, &[&str])] = &[
    (
        "food",
        &[
            "餐饮", "美食", "外卖", "咖啡", "奶茶", "饮", "零食", "水果", "生鲜", "快餐", "食堂",
            "早餐", "午餐", "晚餐", "烧烤", "火锅", "面", "饭",
        ],
    ),
    (
        "shop",
        &[
            "购物",
            "服饰",
            "服装",
            "日用",
            "百货",
            "数码",
            "电器",
            "美妆",
            "化妆",
            "淘宝",
            "京东",
            "拼多多",
            "天猫",
            "网购",
            "家居",
            "母婴",
            "鞋帽",
            "箱包",
        ],
    ),
    (
        "trans",
        &[
            "交通", "出行", "打车", "地铁", "公交", "火车", "高铁", "飞机", "加油", "停车", "滴滴",
            "出租", "车费", "通勤", "单车", "共享",
        ],
    ),
    (
        "home",
        &[
            "居家", "房租", "物业", "水电", "燃气", "家政", "房贷", "缴费", "话费", "宽带", "电费",
            "水费", "充值",
        ],
    ),
    (
        "fun",
        &[
            "娱乐", "游戏", "电影", "休闲", "视频", "会员", "音乐", "ktv", "文化", "演出", "订阅",
            "游玩",
        ],
    ),
    (
        "health",
        &[
            "医疗", "医药", "药", "医院", "健康", "挂号", "体检", "诊所", "牙",
        ],
    ),
    (
        "study",
        &[
            "学习", "教育", "培训", "图书", "书", "课程", "文具", "学费", "知识",
        ],
    ),
    ("gift", &["人情", "红包", "礼", "请客", "份子", "捐"]),
    (
        "travel",
        &[
            "旅行", "旅游", "酒店", "机票", "民宿", "景点", "度假", "住宿",
        ],
    ),
];

const INC_KEYWORDS: &[(&str, &[&str])] = &[
    ("salary", &["工资", "薪", "报酬", "劳务", "发薪"]),
    ("bonus", &["奖金", "红包", "返现", "奖励", "补贴", "退税"]),
    (
        "invest",
        &[
            "理财",
            "收益",
            "基金",
            "股",
            "利息",
            "分红",
            "存款",
            "余额宝",
        ],
    ),
    ("parttime", &["兼职", "外快", "副业", "接单"]),
];

/// Resolve a source category label, with the note as a fallback, to one of our
/// category keys.
///
/// The user's own categories are tried first by exact name, so someone who
/// created a 咖啡 category gets it rather than the generic 餐饮. Then the
/// keyword table, then `other`.
///
/// A keyword hit whose key is not in this direction's category set does **not**
/// stop the search — the loop carries on to the next row. `salary` matching an
/// expense would otherwise swallow the row and return `other`.
pub fn map_category(
    io: Io,
    src_cat: Option<&str>,
    note: Option<&str>,
    custom: &[Category],
) -> String {
    let hay = format!("{} {}", src_cat.unwrap_or(""), note.unwrap_or("")).to_lowercase();
    let cats = all_cats(io, custom);

    // exact label match against real category names
    if let Some(label) = src_cat.filter(|s| !s.is_empty()).map(str::trim) {
        if let Some(hit) = cats
            .iter()
            .find(|c| c.zh == label || c.en.to_lowercase() == label.to_lowercase())
        {
            return hit.k.clone();
        }
    }

    let table = if io == Io::Exp {
        EXP_KEYWORDS
    } else {
        INC_KEYWORDS
    };
    for (key, words) in table {
        if words.iter().any(|w| hay.contains(&w.to_lowercase())) && cats.iter().any(|c| c.k == *key)
        {
            return (*key).to_string();
        }
    }
    "other".to_string()
}

/// Compose a human note from the counterparty and the product description.
///
/// Capped at 80 UTF-16 code units, because that is what `String.prototype.slice`
/// counts. Truncation stops short of splitting a surrogate pair: JavaScript
/// would leave half of one behind, which is not a character, and the TypeScript
/// was changed to agree rather than the port being bent to reproduce it.
pub fn compose_note(bill: &RawBill) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for p in [bill.party.as_deref(), bill.desc.as_deref()] {
        match p.map(str::trim) {
            // `.filter(p => !!p)` — an empty string is dropped, not kept
            Some(t) if !t.is_empty() => parts.push(t),
            _ => {}
        }
    }
    // avoid "X · X" when the counterparty and the description are the same
    parts.dedup();
    truncate_utf16(&parts.join(" · "), 80)
}

/// Keep at most `units` UTF-16 code units, never splitting a surrogate pair.
fn truncate_utf16(s: &str, units: usize) -> String {
    let mut out = String::new();
    let mut used = 0;
    for c in s.chars() {
        let w = c.len_utf16();
        if used + w > units {
            break;
        }
        out.push(c);
        used += w;
    }
    out
}

/* ------------------------------------------------------------- the dedup -- */

/// An existing entry still available to absorb a candidate.
#[derive(Debug, Clone, PartialEq)]
pub struct ExistingRow {
    pub io: Io,
    pub amt: f64,
    /// The calendar day the platform resolved this entry's stamp to.
    pub day: Civil,
    pub note: String,
    /// Match on amount and day alone, ignoring the note.
    pub any_note: bool,
}

/// Project an entry into a dedup slot, or `None` if it cannot absorb anything.
///
/// Deleted entries and transfers are out. `any_note` is set for entries the
/// notification listener captured — see [`to_candidates`] for why.
pub fn existing_row(e: &Entry, day: Civil) -> Option<ExistingRow> {
    if e.deleted_at.is_some() || e.io == Some(Io::Xfer) {
        return None;
    }
    Some(ExistingRow {
        io: e.io?,
        amt: e.amt,
        day,
        note: e.note.clone().unwrap_or_default(),
        any_note: e.src == Some(EntrySource::Notif),
    })
}

/// `x.toFixed(2)` as a string.
///
/// Only ever a bucket key, but a key both sides have to spell the same way.
///
/// The sign comes off **first**, which is what the spec does and what an
/// earlier version here got wrong by rounding before looking. Two things turn
/// on that order: `(-0.001).toFixed(2)` is `"-0.00"`, a signed zero string that
/// rounding-first throws away; and ties round away from zero on the magnitude,
/// so `(-0.005).toFixed(2)` is `"-0.01"` where [`crate::num::js_round`] would
/// have taken -0.5 up to -0.
///
/// Negative zero itself needs no case of its own. `(-0).toFixed(2)` is `"0.00"`
/// because the spec tests `x < 0` and negative zero is not — and `js_round` is
/// `(x + 0.5).floor()`, which turns -0 into +0 on the way through anyway.
fn fixed2(x: f64) -> String {
    if x.is_nan() {
        return "NaN".to_string();
    }
    if x < 0.0 {
        return format!("-{}", fixed2(-x));
    }
    if !x.is_finite() {
        return "Infinity".to_string();
    }
    format!("{:.2}", to_fixed(x, 2))
}

/// Coarse dedup key: same direction, same amount, same calendar day. The note
/// is matched separately, because not every source spells it the same way.
fn loose_key(io: Io, amt: f64, day: Civil) -> String {
    format!(
        "{}|{}|{}-{}-{}",
        io.as_str(),
        fixed2(amt),
        day.y,
        day.m,
        day.d
    )
}

/// Turn parsed bills into import-ready candidates and flag those already in the
/// ledger.
///
/// Dedup is multiset-based: each existing entry is consumed once, so
/// re-importing the same file is idempotent while two genuinely separate
/// same-day payments of the same amount both survive a first import.
///
/// Notification-captured entries match on amount and day alone. A notification
/// carries only the merchant — 星巴克 — while the CSV row for that same payment
/// reads 星巴克咖啡(国贸店) · 消费, so a note-sensitive match would call them
/// different transactions and the monthly import would duplicate every payment
/// the listener already caught. An exact note match is still tried first, so a
/// hand-typed entry is preferred over a captured one when either could absorb
/// the row.
///
/// `existing` order decides which of several equal slots is consumed, so the
/// caller passes entries in ledger order.
pub fn to_candidates(
    bills: &[RawBill],
    existing: &[ExistingRow],
    custom_exp: &[Category],
    custom_inc: &[Category],
) -> Vec<Candidate> {
    let mut buckets: HashMap<String, Vec<&ExistingRow>> = HashMap::new();
    for row in existing {
        buckets
            .entry(loose_key(row.io, row.amt, row.day))
            .or_default()
            .push(row);
    }

    bills
        .iter()
        .map(|b| {
            let note = compose_note(b);
            let custom = if b.io == Io::Exp {
                custom_exp
            } else {
                custom_inc
            };
            let cat = map_category(b.io, b.src_cat.as_deref(), Some(&note), custom);

            let mut dup = false;
            if let Some(bucket) = buckets.get_mut(&loose_key(b.io, b.amt, b.at.date)) {
                let hit = bucket
                    .iter()
                    .position(|s| s.note == note)
                    .or_else(|| bucket.iter().position(|s| s.any_note));
                if let Some(i) = hit {
                    bucket.remove(i); // consume it — one row per entry
                    dup = true;
                }
            }

            Candidate {
                io: b.io,
                cat,
                amt: b.amt,
                note,
                at: b.at,
                dup,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bills::parse_bills;

    fn bill(party: &str, desc: &str, src_cat: &str, io: Io, amt: f64, day: i32) -> RawBill {
        RawBill {
            at: CivilTime {
                date: Civil::new(2026, 0, day),
                h: 12,
                mi: 0,
                s: 0,
            },
            io,
            amt,
            src_cat: (!src_cat.is_empty()).then(|| src_cat.to_string()),
            party: (!party.is_empty()).then(|| party.to_string()),
            desc: (!desc.is_empty()).then(|| desc.to_string()),
            method: None,
            status: None,
        }
    }

    fn slot(note: &str, amt: f64, day: i32, any_note: bool) -> ExistingRow {
        ExistingRow {
            io: Io::Exp,
            amt,
            day: Civil::new(2026, 0, day),
            note: note.to_string(),
            any_note,
        }
    }

    #[test]
    fn a_keyword_in_the_source_category_picks_the_category() {
        assert_eq!(map_category(Io::Exp, Some("餐饮美食"), None, &[]), "food");
        assert_eq!(map_category(Io::Exp, Some("交通出行"), None, &[]), "trans");
        assert_eq!(map_category(Io::Inc, Some("工资"), None, &[]), "salary");
    }

    #[test]
    fn the_note_is_searched_when_the_category_says_nothing() {
        assert_eq!(map_category(Io::Exp, None, Some("滴滴打车"), &[]), "trans");
        assert_eq!(
            map_category(Io::Exp, Some(""), Some("星巴克咖啡"), &[]),
            "food"
        );
    }

    #[test]
    fn nothing_recognisable_falls_through_to_other() {
        assert_eq!(
            map_category(Io::Exp, Some("zzz"), Some("qqq"), &[]),
            "other"
        );
        assert_eq!(map_category(Io::Inc, None, None, &[]), "other");
    }

    #[test]
    fn a_users_own_category_wins_over_the_keyword_table() {
        let custom = vec![Category {
            k: "c1".into(),
            e: "☕".into(),
            zh: "咖啡".into(),
            en: "Coffee".into(),
            c: "#000".into(),
            custom: Some(true),
        }];
        // 咖啡 is a food keyword, but it is also this user's own category
        assert_eq!(map_category(Io::Exp, Some("咖啡"), None, &custom), "c1");
        // and the english name matches case-insensitively
        assert_eq!(map_category(Io::Exp, Some("coffee"), None, &custom), "c1");
    }

    #[test]
    fn a_keyword_hit_for_the_wrong_direction_does_not_stop_the_search() {
        // 红包 is both a bonus keyword and a gift keyword; on an expense only
        // gift exists, and the loop has to reach it
        assert_eq!(map_category(Io::Exp, Some("红包"), None, &[]), "gift");
        assert_eq!(map_category(Io::Inc, Some("红包"), None, &[]), "bonus");
    }

    #[test]
    fn a_note_joins_the_counterparty_and_the_description() {
        let b = bill("肯德基", "午餐", "餐饮", Io::Exp, 35.0, 5);
        assert_eq!(compose_note(&b), "肯德基 · 午餐");
    }

    #[test]
    fn a_repeated_half_is_not_written_twice() {
        let b = bill("星巴克", "星巴克", "", Io::Exp, 35.0, 5);
        assert_eq!(compose_note(&b), "星巴克");
    }

    #[test]
    fn a_missing_half_leaves_no_separator() {
        assert_eq!(
            compose_note(&bill("肯德基", "", "", Io::Exp, 1.0, 5)),
            "肯德基"
        );
        assert_eq!(compose_note(&bill("", "午餐", "", Io::Exp, 1.0, 5)), "午餐");
        assert_eq!(compose_note(&bill("  ", "  ", "", Io::Exp, 1.0, 5)), "");
    }

    #[test]
    fn a_long_note_is_capped_at_eighty_utf16_units() {
        let b = bill(&"字".repeat(100), "", "", Io::Exp, 1.0, 5);
        assert_eq!(compose_note(&b).chars().count(), 80);

        // an emoji is two units, so forty of them fill the cap exactly
        let b = bill(&"🍜".repeat(50), "", "", Io::Exp, 1.0, 5);
        assert_eq!(compose_note(&b).chars().count(), 40);

        // and one that would straddle the boundary is dropped whole
        let b = bill(
            &format!("{}{}", "字".repeat(79), "🍜".repeat(5)),
            "",
            "",
            Io::Exp,
            1.0,
            5,
        );
        let note = compose_note(&b);
        assert_eq!(note.chars().count(), 79);
        assert!(!note.ends_with('🍜'));
    }

    #[test]
    fn a_bill_already_in_the_ledger_is_flagged() {
        let bills = vec![bill("肯德基", "午餐", "餐饮", Io::Exp, 35.0, 5)];
        let existing = vec![slot("肯德基 · 午餐", 35.0, 5, false)];
        let out = to_candidates(&bills, &existing, &[], &[]);
        assert!(out[0].dup);
        assert_eq!(out[0].cat, "food");
    }

    #[test]
    fn a_different_day_or_amount_is_not_a_duplicate() {
        let bills = vec![bill("肯德基", "午餐", "", Io::Exp, 35.0, 5)];
        assert!(!to_candidates(&bills, &[slot("肯德基 · 午餐", 35.0, 6, false)], &[], &[])[0].dup);
        assert!(!to_candidates(&bills, &[slot("肯德基 · 午餐", 36.0, 5, false)], &[], &[])[0].dup);
    }

    #[test]
    fn each_existing_entry_absorbs_only_one_row() {
        // two identical payments on one day, one already recorded
        let bills = vec![
            bill("肯德基", "午餐", "", Io::Exp, 35.0, 5),
            bill("肯德基", "午餐", "", Io::Exp, 35.0, 5),
        ];
        let out = to_candidates(&bills, &[slot("肯德基 · 午餐", 35.0, 5, false)], &[], &[]);
        assert_eq!((out[0].dup, out[1].dup), (true, false));
    }

    #[test]
    fn a_captured_entry_matches_on_amount_and_day_alone() {
        // the listener saw 星巴克; the CSV row spells it out in full
        let bills = vec![bill("星巴克咖啡(国贸店)", "消费", "", Io::Exp, 35.0, 5)];
        let out = to_candidates(&bills, &[slot("星巴克", 35.0, 5, true)], &[], &[]);
        assert!(out[0].dup);
    }

    #[test]
    fn an_exact_note_is_preferred_over_a_captured_entry() {
        let bills = vec![bill("肯德基", "午餐", "", Io::Exp, 35.0, 5)];
        // the captured slot comes first but the hand-typed one should be taken
        let existing = vec![
            slot("星巴克", 35.0, 5, true),
            slot("肯德基 · 午餐", 35.0, 5, false),
        ];
        let out = to_candidates(&bills, &existing, &[], &[]);
        assert!(out[0].dup);

        // proof it consumed the exact one: a second identical row can still
        // fall back to the captured slot
        let bills = vec![
            bill("肯德基", "午餐", "", Io::Exp, 35.0, 5),
            bill("肯德基", "午餐", "", Io::Exp, 35.0, 5),
        ];
        let out = to_candidates(&bills, &existing, &[], &[]);
        assert_eq!((out[0].dup, out[1].dup), (true, true));
    }

    #[test]
    fn deleted_entries_and_transfers_cannot_absorb_anything() {
        let mut e = Entry {
            id: "e1".into(),
            ts: 0,
            io: Some(Io::Exp),
            cat: "food".into(),
            amt: 35.0,
            note: Some("肯德基".into()),
            ..Default::default()
        };
        assert!(existing_row(&e, Civil::new(2026, 0, 5)).is_some());

        e.deleted_at = Some(1);
        assert!(existing_row(&e, Civil::new(2026, 0, 5)).is_none());

        e.deleted_at = None;
        e.io = Some(Io::Xfer);
        assert!(existing_row(&e, Civil::new(2026, 0, 5)).is_none());
    }

    #[test]
    fn the_whole_path_from_csv_text_to_candidates() {
        let csv = "支付宝交易记录\n\
交易时间,交易分类,交易对方,商品说明,收/支,金额,交易状态\n\
2026-01-05 12:30:00,餐饮,肯德基,午餐,支出,35.50,交易成功\n\
2026-01-06 09:00:00,工资,公司,一月,收入,9000.00,交易成功\n";
        let parsed = parse_bills(csv);
        let out = to_candidates(&parsed.bills, &[], &[], &[]);
        assert_eq!(out.len(), 2);
        assert_eq!((out[0].cat.as_str(), out[0].amt), ("food", 35.5));
        assert_eq!((out[1].cat.as_str(), out[1].amt), ("salary", 9000.0));
        assert!(out.iter().all(|c| !c.dup));
    }
}
