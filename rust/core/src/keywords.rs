//! Resolving a free-text label to one of the app's category keys.
//!
//! Ported from the category half of `src/domain/billDedup.ts`. Bill import and
//! notification capture both arrive with a merchant name or a bank's own
//! category label and no idea which of our buckets it belongs in; this is the
//! guess, and it is deliberately a guess — every screen that uses it leaves the
//! category editable.
//!
//! Order matters twice over. The exact-name match runs first so a user who made
//! their own 咖啡 category gets it instead of `food`. Within the keyword table
//! the first key whose word appears wins, so the tables are ordered by how
//! specific the bucket is, not alphabetically.

use crate::catalog::{all_cats, Category};
use crate::entry::Io;

/// Substring keyword to category key, scoped by direction. First match wins.
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

/// Resolve a source label (and a note to fall back on) to a category key.
///
/// `src_cat` is what the bank or the CSV called it; `note` is the merchant or
/// description. Both are searched, lower-cased, so an English keyword like
/// `ktv` matches whatever case it arrived in.
///
/// A keyword hit is only honoured when that key actually exists for this
/// direction — the tables and the category list are edited independently, and a
/// key that has been renamed away should fall through to `other` rather than
/// name a bucket nothing can show.
pub fn map_category(
    io: Io,
    src_cat: Option<&str>,
    note: Option<&str>,
    custom: &[Category],
) -> String {
    let hay = format!("{} {}", src_cat.unwrap_or(""), note.unwrap_or("")).to_lowercase();
    let cats = all_cats(io, custom);

    // an exact name match wins, so a user's own 咖啡 category beats `food`
    if let Some(label) = src_cat.map(str::trim).filter(|l| !l.is_empty()) {
        let lower = label.to_lowercase();
        if let Some(hit) = cats
            .iter()
            .find(|c| c.zh == label || c.en.to_lowercase() == lower)
        {
            return hit.k.clone();
        }
    }

    let table = if io == Io::Inc {
        INC_KEYWORDS
    } else {
        EXP_KEYWORDS
    };
    for (key, words) in table {
        if words.iter().any(|w| hay.contains(&w.to_lowercase())) && cats.iter().any(|c| c.k == *key)
        {
            return key.to_string();
        }
    }
    "other".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_keyword_in_the_note_picks_the_bucket() {
        assert_eq!(map_category(Io::Exp, None, Some("星巴克咖啡"), &[]), "food");
        assert_eq!(map_category(Io::Exp, None, Some("滴滴出行"), &[]), "trans");
        assert_eq!(map_category(Io::Exp, None, Some("房租"), &[]), "home");
        assert_eq!(map_category(Io::Inc, None, Some("八月工资"), &[]), "salary");
    }

    #[test]
    fn nothing_recognisable_falls_through_to_other() {
        assert_eq!(map_category(Io::Exp, None, Some("zzz"), &[]), "other");
        assert_eq!(map_category(Io::Exp, None, None, &[]), "other");
    }

    #[test]
    fn an_exact_category_name_beats_the_keyword_table() {
        // 餐饮 is a keyword for `food` and also the display name of `food`
        assert_eq!(map_category(Io::Exp, Some("餐饮"), None, &[]), "food");
        // and a custom category with that exact name wins over the built-in
        let custom = vec![Category {
            k: "c1".into(),
            e: "☕".into(),
            zh: "咖啡".into(),
            en: "Coffee".into(),
            c: "#000".into(),
            custom: Some(true),
        }];
        assert_eq!(map_category(Io::Exp, Some("咖啡"), None, &custom), "c1");
        // without it, 咖啡 is only a food keyword
        assert_eq!(map_category(Io::Exp, Some("咖啡"), None, &[]), "food");
    }

    #[test]
    fn an_english_name_matches_case_insensitively() {
        assert_eq!(map_category(Io::Exp, Some("food"), None, &[]), "food");
        assert_eq!(map_category(Io::Exp, Some("FOOD"), None, &[]), "food");
        assert_eq!(map_category(Io::Exp, Some("  Food  "), None, &[]), "food");
    }

    #[test]
    fn an_english_keyword_matches_whatever_case_it_arrived_in() {
        assert_eq!(map_category(Io::Exp, None, Some("KTV 消费"), &[]), "fun");
    }

    #[test]
    fn the_first_matching_key_wins() {
        // 红包 is a keyword for both `gift` (expense) and `bonus` (income);
        // direction decides which table is even consulted
        assert_eq!(map_category(Io::Exp, None, Some("发红包"), &[]), "gift");
        assert_eq!(map_category(Io::Inc, None, Some("抢到红包"), &[]), "bonus");
    }

    #[test]
    fn a_transfer_has_no_categories_so_everything_is_other() {
        // allCats('xfer') is empty, so no key can be honoured
        assert_eq!(map_category(Io::Xfer, None, Some("餐饮"), &[]), "other");
    }

    #[test]
    fn both_fields_are_searched_together() {
        assert_eq!(
            map_category(Io::Exp, Some("未知"), Some("地铁"), &[]),
            "trans"
        );
    }
}
