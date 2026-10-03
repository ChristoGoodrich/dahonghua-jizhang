//! Amounts and days, read out of what a person types — or says, into a
//! keyboard's voice button.
//!
//! Nothing here is a model. It is the offline half of 一句话记账 and 问账本, and
//! it is also what checks the model: an amount or a day the model hands back
//! goes through the same bounds as one read here.

use std::sync::OnceLock;

use regex_lite::Regex;

use crate::civil::Civil;

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("pattern compiles"))
}

/// Above this an "amount" is a misreading, not a transaction — and it keeps the
/// number well inside the range where it prints as digits.
pub const MAX_AMOUNT: f64 = 1e12;

/// A usable amount: positive, finite, not absurd, to the cent.
pub fn clean_amount(n: f64) -> Option<f64> {
    if n.is_finite() && n > 0.0 && n <= MAX_AMOUNT {
        Some(crate::num::round2(n))
    } else {
        None
    }
}

/// Full-width forms to their ASCII selves — `３５．５` is 35.5 — and the
/// ideographic space to a space. A Chinese keyboard produces both freely.
pub fn half_width(s: &str) -> String {
    strip_thousands(
        &s.chars()
            .map(|c| match c {
                '\u{3000}' => ' ',
                // the full-width block mirrors ASCII 0x21..0x7E, offset by 0xFEE0;
                // the separators the parser splits on keep their CJK forms, which
                // are outside this block
                '\u{FF01}'..='\u{FF5E}' if !matches!(c, '，' | '；' | '：' | '（' | '）') => {
                    char::from_u32(c as u32 - 0xFEE0).unwrap_or(c)
                }
                _ => c,
            })
            .collect::<String>(),
    )
}

/// `1,800` is one number, not two items: a comma between a digit and exactly
/// three more digits is a thousands mark and goes, so the sentence can still be
/// cut at every other comma.
fn strip_thousands(s: &str) -> String {
    let c: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    for (i, &ch) in c.iter().enumerate() {
        if ch == ','
            && i > 0
            && c[i - 1].is_ascii_digit()
            && c.len() > i + 3
            && c[i + 1..=i + 3].iter().all(|d| d.is_ascii_digit())
            && !c.get(i + 4).is_some_and(|d| d.is_ascii_digit())
        {
            continue;
        }
        out.push(ch);
    }
    out
}

fn cn_digit(c: char) -> Option<u64> {
    Some(match c {
        '零' | '〇' => 0,
        '一' | '壹' => 1,
        '二' | '两' | '贰' => 2,
        '三' | '叁' => 3,
        '四' | '肆' => 4,
        '五' | '伍' => 5,
        '六' | '陆' => 6,
        '七' | '柒' => 7,
        '八' | '捌' => 8,
        '九' | '玖' => 9,
        _ => return None,
    })
}

fn cn_unit(c: char) -> Option<u64> {
    Some(match c {
        '十' | '拾' => 10,
        '百' | '佰' => 100,
        '千' | '仟' => 1000,
        _ => return None,
    })
}

/// A number written in Chinese: 三十五, 一百二十, 两千五, 一万二, 十五, 三十五点五.
///
/// The colloquial trailing digit is read the way it is said: 一百二 is 120 and
/// 两千五 is 2500 — the digit after a unit counts in the next unit down.
/// `None` for anything that is not entirely a number.
pub fn cn_number(s: &str) -> Option<f64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    let (int, frac) = match s.split_once('点') {
        Some((a, b)) => (a, Some(b)),
        None => (s, None),
    };

    let mut total: u64 = 0; // everything above the current 万 group
    let mut section: u64 = 0; // the current group, below 万
    let mut digit: Option<u64> = None;
    let mut last_unit: u64 = 1;
    let mut saw_any = false;
    for c in int.chars() {
        if let Some(d) = cn_digit(c) {
            // 一千零五: after a 零 the next digit is a units digit, not the
            // colloquial next-unit-down of 两千五
            if d == 0 {
                last_unit = 1;
            }
            digit = Some(d);
            saw_any = true;
        } else if let Some(u) = cn_unit(c) {
            // 十五: a unit with no digit before it is one of that unit
            section += digit.take().unwrap_or(1) * u;
            last_unit = u;
            saw_any = true;
        } else if c == '万' {
            section += digit.take().unwrap_or(0);
            total += section.max(if saw_any { 0 } else { 1 }) * 10_000;
            section = 0;
            last_unit = 10_000;
            saw_any = true;
        } else {
            return None;
        }
    }
    if let Some(d) = digit {
        // 一百二 → 120, 两千五 → 2500, 一万二 → 12000; 三十五 → 35
        section += if last_unit > 10 {
            d * last_unit / 10
        } else {
            d
        };
    }
    let mut n = (total + section) as f64;
    if !saw_any {
        return None;
    }
    if let Some(f) = frac {
        // 三点 is a time and 一点 is "a little"; only 三点五 is a number
        if f.is_empty() {
            return None;
        }
        let mut scale = 0.1;
        for c in f.chars() {
            n += cn_digit(c)? as f64 * scale;
            scale /= 10.0;
        }
    }
    Some(n)
}

/// Chinese numbers that are amounts, turned into digits: 午饭三十五 → 午饭35.
///
/// Only a run that reads as a price is turned — one with a unit in it (十, 百,
/// 千, 万, 点) or followed by 元/块/钱/毛. A lone 一 or 两 is left alone, because
/// 一杯咖啡 and 两份饭 are counts, and 星期一 is a day.
pub fn cn_amounts_to_digits(s: &str) -> String {
    static R: OnceLock<Regex> = OnceLock::new();
    let r = re(
        &R,
        "[零〇一二两三四五六七八九十百千万点壹贰叁肆伍陆柒捌玖拾佰仟]+",
    );
    let mut out = String::with_capacity(s.len());
    let mut last = 0;
    for m in r.find_iter(s) {
        let run = m.as_str();
        let after = &s[m.end()..];
        let unit = run.chars().any(|c| "十百千万点拾佰仟".contains(c));
        let money = after.starts_with('元')
            || after.starts_with('块')
            || after.starts_with('钱')
            || after.starts_with('毛');
        // the change after the unit: 十二块五 is 12.5
        let change = run.chars().count() == 1
            && (s[..m.start()].ends_with('块') || s[..m.start()].ends_with('元'));
        out.push_str(&s[last..m.start()]);
        match cn_number(run).filter(|_| unit || money || change) {
            Some(n) => out.push_str(&crate::num::js_num(n)),
            None => out.push_str(run),
        }
        last = m.end();
    }
    out.push_str(&s[last..]);
    out
}

/// An amount found in a sentence, and where it sat.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Found {
    pub amount: f64,
    pub start: usize,
    pub end: usize,
}

/// Every amount in `s` (already half-width, numerals already digits), in order.
///
/// A number is not an amount when it is a count or a time — `2杯`, `3天`,
/// `10点`, `5号线`, `8折` — or when it follows 第/周/近/最近. `12块5` is 12.5
/// and so is `12元5角`: the way change is said.
pub fn amounts(s: &str) -> Vec<Found> {
    static NUM: OnceLock<Regex> = OnceLock::new();
    let num = re(
        &NUM,
        r"[¥￥$]?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*(?:(?:元|块钱|块|rmb|RMB|CNY)\s*([0-9])\s*(?:毛|角)?|(元|块钱|块|rmb|RMB|CNY|毛|角))?",
    );
    static NOT_AFTER: OnceLock<Regex> = OnceLock::new();
    let not_after = re(
        &NOT_AFTER,
        r"^\s*(?:月|日|号|点|时|分钟|分|天|周|星期|年|个|杯|份|斤|次|瓶|碗|人|位|张|件|岁|楼|层|路|公里|km|折|%|倍|小时|:|：|号线|期|章|页|条|只|盒|包|袋|双|本|支|根|粒|片|桌|间|套|台|部)",
    );
    static NOT_BEFORE: OnceLock<Regex> = OnceLock::new();
    let not_before = re(&NOT_BEFORE, r"(?:第|周|星期|礼拜|近|最近|过去|前)\s*$");

    let mut out = Vec::new();
    for c in num.captures_iter(s) {
        let whole = c.get(0).expect("group 0");
        let digits = c.get(1).expect("group 1");
        let before = &s[..whole.start()];
        let after = &s[whole.end()..];
        let unit = c.get(3).map(|m| m.as_str());
        if unit.is_none() && c.get(2).is_none() {
            if not_after.is_match(after) || not_before.is_match(before) {
                continue;
            }
            // a time: 12:30, either half of it
            if after.starts_with(':') || before.ends_with(':') {
                continue;
            }
        }
        let mut n: f64 = match digits.as_str().replace(',', "").parse() {
            Ok(n) => n,
            Err(_) => continue,
        };
        if let Some(jiao) = c.get(2) {
            n += jiao.as_str().parse::<f64>().unwrap_or(0.0) / 10.0;
        }
        match unit {
            Some("毛") | Some("角") => n /= 10.0,
            _ => {}
        }
        if let Some(amount) = clean_amount(n) {
            out.push(Found {
                amount,
                start: whole.start(),
                end: whole.end(),
            });
        }
    }
    out
}

/* ------------------------------------------------------------------ days -- */

/// `y-m-d`, zero-padded, with a 1-based month: what a model is asked for and
/// what it is told today is.
pub fn iso(d: Civil) -> String {
    format!("{:04}-{:02}-{:02}", d.y, d.m + 1, d.d)
}

/// 周一 … 周日, for telling a model what today is. Protocol, not display: the
/// model reads it, the user never does.
pub fn weekday_zh(d: Civil) -> &'static str {
    ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][d.weekday_monday_first() as usize]
}

fn weekday_of(c: &str) -> Option<i32> {
    Some(match c {
        "一" | "1" => 0,
        "二" | "2" => 1,
        "三" | "3" => 2,
        "四" | "4" => 3,
        "五" | "5" => 4,
        "六" | "6" => 5,
        "日" | "天" | "7" | "末" => 6,
        _ => return None,
    })
}

fn small_number(s: &str) -> Option<i64> {
    if let Ok(n) = s.parse::<i64>() {
        return Some(n);
    }
    cn_number(s).map(|n| n as i64)
}

/// The first day named in `s`, and `s` without it.
///
/// Relative words are read against `today`; a date without a year is this
/// year's, unless that is still ahead, when it is last year's — a note about
/// 12月30日 written on January 2nd is about the week before. A day ahead of
/// `today` is never returned: an entry cannot have happened tomorrow.
pub fn take_day(s: &str, today: Civil) -> (String, Option<Civil>) {
    static FULL: OnceLock<Regex> = OnceLock::new();
    static MD: OnceLock<Regex> = OnceLock::new();
    static SLASH: OnceLock<Regex> = OnceLock::new();
    static AGO: OnceLock<Regex> = OnceLock::new();
    static LAST_WEEK: OnceLock<Regex> = OnceLock::new();
    static WEEKDAY: OnceLock<Regex> = OnceLock::new();
    static REL: OnceLock<Regex> = OnceLock::new();

    let full = re(
        &FULL,
        r"([0-9]{4})\s*[-/.年]\s*([0-9]{1,2})\s*[-/.月]\s*([0-9]{1,2})\s*[日号]?",
    );
    let md = re(
        &MD,
        r"([0-9]{1,2}|[一二三四五六七八九十]{1,3})月([0-9]{1,2}|[一二三四五六七八九十]{1,3})[日号]?",
    );
    let slash = re(
        &SLASH,
        r"(?:^|[^0-9.])([0-9]{1,2})/([0-9]{1,2})(?:[^0-9]|$)",
    );
    let ago = re(
        &AGO,
        r"([0-9]{1,3}|[一二两三四五六七八九十]{1,3})\s*天(?:以)?前",
    );
    let last_week = re(
        &LAST_WEEK,
        r"(上+)\s*(?:个)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天1-7])",
    );
    let weekday = re(
        &WEEKDAY,
        r"(?:本|这)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天1-7])",
    );
    let rel = re(
        &REL,
        r"大前天|前天|昨天|昨日|昨晚|昨早|昨夜|昨儿|今天|今日|今早|今晚|今儿|今夜",
    );

    let not_ahead = |d: Civil| if d > today { None } else { Some(d) };
    let cut = |m: regex_lite::Match| format!("{} {}", &s[..m.start()], &s[m.end()..]);

    if let Some(c) = full.captures(s) {
        let (y, m, d) = (
            c[1].parse::<i32>().unwrap_or(0),
            c[2].parse::<i32>().unwrap_or(0),
            c[3].parse::<i32>().unwrap_or(0),
        );
        if (1..=12).contains(&m) && (1..=31).contains(&d) {
            return (
                cut(c.get(0).expect("0")),
                not_ahead(Civil::new(y, m - 1, d)),
            );
        }
    }
    if let Some(c) = md.captures(s) {
        let (m, d) = (
            small_number(&c[1]).unwrap_or(0),
            small_number(&c[2]).unwrap_or(0),
        );
        if (1..=12).contains(&m) && (1..=31).contains(&d) {
            let mut day = Civil::new(today.y, m as i32 - 1, d as i32);
            if day > today {
                day = Civil::new(today.y - 1, m as i32 - 1, d as i32);
            }
            return (cut(c.get(0).expect("0")), Some(day));
        }
    }
    if let Some(c) = slash.captures(s) {
        let (m, d) = (
            c[1].parse::<i32>().unwrap_or(0),
            c[2].parse::<i32>().unwrap_or(0),
        );
        if (1..=12).contains(&m) && (1..=31).contains(&d) {
            let g = c.get(1).expect("1");
            let e = c.get(2).expect("2");
            let mut day = Civil::new(today.y, m - 1, d);
            if day > today {
                day = Civil::new(today.y - 1, m - 1, d);
            }
            return (format!("{} {}", &s[..g.start()], &s[e.end()..]), Some(day));
        }
    }
    if let Some(c) = ago.captures(s) {
        if let Some(n) = small_number(&c[1]).filter(|n| (0..=3660).contains(n)) {
            let day = Civil::from_day_number(today.day_number() - n);
            return (cut(c.get(0).expect("0")), Some(day));
        }
    }
    if let Some(c) = last_week.captures(s) {
        let weeks = c[1].chars().count() as i64;
        if let Some(w) = weekday_of(&c[2]) {
            let monday = today.day_number() - today.weekday_monday_first() as i64;
            let day = Civil::from_day_number(monday - 7 * weeks + w as i64);
            return (cut(c.get(0).expect("0")), not_ahead(day));
        }
    }
    if let Some(c) = weekday.captures(s) {
        if let Some(w) = weekday_of(&c[1]) {
            let monday = today.day_number() - today.weekday_monday_first() as i64;
            let mut n = monday + w as i64;
            // 周五打车, said on a Wednesday, is last Friday's
            if n > today.day_number() {
                n -= 7;
            }
            return (cut(c.get(0).expect("0")), Some(Civil::from_day_number(n)));
        }
    }
    if let Some(m) = rel.find(s) {
        let back = match m.as_str() {
            "大前天" => 3,
            "前天" => 2,
            w if w.starts_with('昨') => 1,
            _ => 0,
        };
        let day = Civil::from_day_number(today.day_number() - back);
        return (cut(m), Some(day));
    }
    (s.to_string(), None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(y: i32, m: i32, d: i32) -> Civil {
        Civil::new(y, m - 1, d)
    }

    #[test]
    fn chinese_numbers_are_read_the_way_they_are_said() {
        for (s, n) in [
            ("三十五", 35.0),
            ("十五", 15.0),
            ("十", 10.0),
            ("一百二十", 120.0),
            ("一百二", 120.0),
            ("两千五", 2500.0),
            ("一万二", 12000.0),
            ("三万五千", 35000.0),
            ("一千零五", 1005.0),
            ("三十五点五", 35.5),
            ("两百", 200.0),
            ("九", 9.0),
        ] {
            assert_eq!(cn_number(s), Some(n), "{s}");
        }
        assert_eq!(cn_number("咖啡"), None);
        assert_eq!(cn_number("一点"), None, "a little is not a number");
        assert_eq!(cn_number("三点"), None, "and three o'clock is a time");
        assert_eq!(cn_number(""), None);
    }

    #[test]
    fn only_a_chinese_price_becomes_digits() {
        assert_eq!(cn_amounts_to_digits("午饭三十五"), "午饭35");
        assert_eq!(cn_amounts_to_digits("打车十二块"), "打车12块");
        assert_eq!(cn_amounts_to_digits("房租两千五"), "房租2500");
        assert_eq!(cn_amounts_to_digits("奶茶五块"), "奶茶5块");
        // counts and days are not prices
        assert_eq!(cn_amounts_to_digits("两杯咖啡"), "两杯咖啡");
        assert_eq!(cn_amounts_to_digits("星期一"), "星期一");
        assert_eq!(cn_amounts_to_digits("一共"), "一共");
        assert_eq!(
            cn_amounts_to_digits("十二块五"),
            "12块5",
            "the change after the unit"
        );
        assert_eq!(cn_amounts_to_digits("便宜一点"), "便宜一点");
    }

    #[test]
    fn full_width_digits_are_digits() {
        assert_eq!(half_width("午饭３５．５"), "午饭35.5");
        assert_eq!(
            half_width("午饭，打车"),
            "午饭，打车",
            "separators keep their form"
        );
        assert_eq!(
            half_width("房租1,800,打车12"),
            "房租1800,打车12",
            "a thousands mark goes"
        );
    }

    fn found(s: &str) -> Vec<f64> {
        amounts(s).iter().map(|f| f.amount).collect()
    }

    #[test]
    fn amounts_are_found_and_counts_are_not() {
        assert_eq!(found("午饭35打车12"), vec![35.0, 12.0]);
        assert_eq!(found("咖啡2杯36"), vec![36.0]);
        assert_eq!(found("¥35.50"), vec![35.5]);
        assert_eq!(found("12块5"), vec![12.5]);
        assert_eq!(found("12元5角"), vec![12.5]);
        assert_eq!(found("5毛"), vec![0.5]);
        assert_eq!(found("地铁5号线4"), vec![4.0]);
        assert_eq!(found("10点吃饭30"), vec![30.0]);
        assert_eq!(found("8折买鞋299"), vec![299.0]);
        assert_eq!(found("房租1,800"), vec![1800.0]);
        assert_eq!(found("12:30午饭"), Vec::<f64>::new());
        assert_eq!(found("第3次"), Vec::<f64>::new());
        assert!(found("0").is_empty(), "nothing is not an amount");
    }

    #[test]
    fn days_are_read_against_today() {
        let today = c(2026, 9, 23); // a Wednesday
        let day = |s: &str| take_day(s, today).1;
        assert_eq!(day("昨天打车"), Some(c(2026, 9, 22)));
        assert_eq!(day("前天"), Some(c(2026, 9, 21)));
        assert_eq!(day("大前天"), Some(c(2026, 9, 20)));
        assert_eq!(day("今晚火锅"), Some(today));
        assert_eq!(day("3天前"), Some(c(2026, 9, 20)));
        assert_eq!(day("三天前"), Some(c(2026, 9, 20)));
        assert_eq!(day("上周三"), Some(c(2026, 9, 16)));
        assert_eq!(day("上上周一"), Some(c(2026, 9, 7)));
        assert_eq!(day("周一"), Some(c(2026, 9, 21)));
        assert_eq!(
            day("周五"),
            Some(c(2026, 9, 18)),
            "a weekday still ahead is last week's"
        );
        assert_eq!(day("9月21日"), Some(c(2026, 9, 21)));
        assert_eq!(day("九月二十一号"), Some(c(2026, 9, 21)));
        assert_eq!(
            day("12月30日"),
            Some(c(2025, 12, 30)),
            "ahead this year: last year's"
        );
        assert_eq!(day("9/21"), Some(c(2026, 9, 21)));
        assert_eq!(day("2026-09-01"), Some(c(2026, 9, 1)));
        assert_eq!(day("2026年9月1日"), Some(c(2026, 9, 1)));
        assert_eq!(
            day("2026-12-01"),
            None,
            "a day ahead is not a day an entry had"
        );
        assert_eq!(day("午饭35"), None);
        // 12.5 is money, not December the fifth
        assert_eq!(day("午饭12.5"), None);
    }

    #[test]
    fn the_day_is_cut_out_of_the_text() {
        let (rest, d) = take_day("昨天打车35", Civil::new(2026, 8, 23));
        assert!(d.is_some());
        assert_eq!(rest.trim(), "打车35");
    }
}
