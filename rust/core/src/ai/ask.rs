//! 问账本 — a question about the ledger, answered on the phone.
//!
//! The question is turned into a query — which days, which side, which
//! categories, what to match, how to group and what to measure — and the query
//! is run here, over the ledger, by the same filters the rest of the app uses.
//! A model, when there is one, only ever does the first half: it reads the
//! question and writes the query. **It never sees a row.** That is the whole
//! design, and it is why "上个月外卖花了多少" can be asked of a model at all by
//! an app whose ledger does not leave the device.
//!
//! The periods a query names are resolved here too, and "this month" is the
//! billing cycle the rest of the app means by it: 明细's 本月攒下的, 统计's 月,
//! and this, all start on the same day.

use std::sync::OnceLock;

use regex_lite::Regex;

use crate::catalog::all_cats;
use crate::civil::{parse_iso_date, Civil};
use crate::cycle::{cycle_range, shift_cycle};
use crate::entry::{Entry, Io};
use crate::jsval::Value;
use crate::keywords::map_category;
use crate::search::matches_search;

use super::quick::{extract_json, number_in, resolve_category, text_in, Custom};
use super::words::{cn_number, half_width};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Metric {
    Sum,
    Count,
    /// Per day of the range.
    AvgDay,
    /// Per entry.
    AvgEntry,
    /// The largest single entry.
    Max,
}

impl Metric {
    pub fn as_str(self) -> &'static str {
        match self {
            Metric::Sum => "sum",
            Metric::Count => "count",
            Metric::AvgDay => "avg_day",
            Metric::AvgEntry => "avg_entry",
            Metric::Max => "max",
        }
    }
    fn parse(s: &str) -> Metric {
        match s {
            "count" => Metric::Count,
            "avg_day" | "avg" | "average" => Metric::AvgDay,
            "avg_entry" => Metric::AvgEntry,
            "max" => Metric::Max,
            _ => Metric::Sum,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Group {
    None,
    Category,
    Day,
    Month,
}

impl Group {
    pub fn as_str(self) -> &'static str {
        match self {
            Group::None => "none",
            Group::Category => "category",
            Group::Day => "day",
            Group::Month => "month",
        }
    }
    fn parse(s: &str) -> Group {
        match s {
            "category" | "cat" => Group::Category,
            "day" => Group::Day,
            "month" => Group::Month,
            _ => Group::None,
        }
    }
}

/// What to look for. `to` is inclusive.
#[derive(Debug, Clone, PartialEq)]
pub struct AskQuery {
    pub from: Civil,
    pub to: Civil,
    pub io: Io,
    /// Category keys; empty is all of them.
    pub cats: Vec<String>,
    /// Text to match in the note, the category name and the tags.
    pub keyword: String,
    pub group: Group,
    pub metric: Metric,
}

/// A span of days a question can name. Resolved against today and the cycle
/// start, here, whoever named it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Period {
    Today,
    Yesterday,
    ThisWeek,
    LastWeek,
    ThisMonth,
    LastMonth,
    ThisYear,
    LastYear,
    LastDays(i64),
    /// A calendar month, 0-based.
    Month(i32, i32),
    All,
    Custom(Civil, Civil),
}

/// The first day the ledger could hold, for "all of it".
const EPOCH: Civil = Civil {
    y: 2000,
    m: 0,
    d: 1,
};

pub fn resolve(p: Period, today: Civil, cycle_start: i32) -> (Civil, Civil) {
    let n = today.day_number();
    let monday = n - today.weekday_monday_first() as i64;
    let day = Civil::from_day_number;
    match p {
        Period::Today => (today, today),
        Period::Yesterday => (day(n - 1), day(n - 1)),
        Period::ThisWeek => (day(monday), day(monday + 6)),
        Period::LastWeek => (day(monday - 7), day(monday - 1)),
        Period::ThisMonth => {
            let r = cycle_range(today, cycle_start);
            (r.start, day(r.end.day_number() - 1))
        }
        Period::LastMonth => {
            let r = cycle_range(shift_cycle(today, -1, cycle_start), cycle_start);
            (r.start, day(r.end.day_number() - 1))
        }
        Period::ThisYear => (Civil::new(today.y, 0, 1), Civil::new(today.y, 11, 31)),
        Period::LastYear => (
            Civil::new(today.y - 1, 0, 1),
            Civil::new(today.y - 1, 11, 31),
        ),
        Period::LastDays(k) => (day(n - k.clamp(1, 3660) + 1), today),
        Period::Month(y, m) => (Civil::new(y, m, 1), Civil::new(y, m + 1, 0)),
        Period::All => (EPOCH, today),
        Period::Custom(a, b) => {
            if a <= b {
                (a, b)
            } else {
                (b, a)
            }
        }
    }
}

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("pattern compiles"))
}

fn count_of(s: &str) -> Option<i64> {
    s.parse::<i64>()
        .ok()
        .or_else(|| cn_number(s).map(|n| n as i64))
}

/// The period a question names, and the question without it. Defaults to this
/// cycle, which is what "花了多少" means when nothing says otherwise.
fn take_period(q: &str, today: Civil) -> (String, Period) {
    static LAST_N: OnceLock<Regex> = OnceLock::new();
    static YM: OnceLock<Regex> = OnceLock::new();
    static M: OnceLock<Regex> = OnceLock::new();
    let last_n = re(
        &LAST_N,
        r"(?:最近|近|过去|这)\s*([0-9]{1,4}|[一二两三四五六七八九十百]{1,4})\s*(天|日|周|星期|个星期|个月|月|年)",
    );
    let ym = re(&YM, r"([0-9]{4})\s*年\s*([0-9]{1,2})\s*月份?");
    let m = re(&M, r"([0-9]{1,2}|[一二三四五六七八九十]{1,3})\s*月份?");

    let cut = |a: usize, b: usize| format!("{} {}", &q[..a], &q[b..]);

    if let Some(c) = last_n.captures(q) {
        if let Some(k) = count_of(&c[1]).filter(|k| *k > 0) {
            let days = match &c[2] {
                "天" | "日" => k,
                "周" | "星期" | "个星期" => k * 7,
                "年" => k * 365,
                _ => k * 30,
            };
            let g = c.get(0).expect("0");
            return (cut(g.start(), g.end()), Period::LastDays(days));
        }
    }
    if let Some(c) = ym.captures(q) {
        let (y, mo) = (
            c[1].parse::<i32>().unwrap_or(0),
            c[2].parse::<i32>().unwrap_or(0),
        );
        if (1..=12).contains(&mo) {
            let g = c.get(0).expect("0");
            return (cut(g.start(), g.end()), Period::Month(y, mo - 1));
        }
    }
    const WORDS: &[(&str, Period)] = &[
        ("最近一周", Period::LastDays(7)),
        ("近一周", Period::LastDays(7)),
        ("最近一个月", Period::LastDays(30)),
        ("上上个月", Period::All), // replaced below: two cycles back
        ("上个星期", Period::LastWeek),
        ("上星期", Period::LastWeek),
        ("上礼拜", Period::LastWeek),
        ("上周", Period::LastWeek),
        ("这个星期", Period::ThisWeek),
        ("这星期", Period::ThisWeek),
        ("本星期", Period::ThisWeek),
        ("这礼拜", Period::ThisWeek),
        ("本周", Period::ThisWeek),
        ("这周", Period::ThisWeek),
        ("上个月", Period::LastMonth),
        ("上月", Period::LastMonth),
        ("上期", Period::LastMonth),
        ("这个月", Period::ThisMonth),
        ("本月", Period::ThisMonth),
        ("这月", Period::ThisMonth),
        ("当月", Period::ThisMonth),
        ("本期", Period::ThisMonth),
        ("今年", Period::ThisYear),
        ("本年", Period::ThisYear),
        ("去年", Period::LastYear),
        ("前天", Period::Custom(EPOCH, EPOCH)), // replaced below
        ("昨天", Period::Yesterday),
        ("昨日", Period::Yesterday),
        ("今天", Period::Today),
        ("今日", Period::Today),
        ("一共", Period::All),
        ("总共", Period::All),
        ("全部", Period::All),
        ("所有", Period::All),
        ("至今", Period::All),
        ("有史以来", Period::All),
        ("this month", Period::ThisMonth),
        ("last month", Period::LastMonth),
        ("this week", Period::ThisWeek),
        ("last week", Period::LastWeek),
        ("this year", Period::ThisYear),
        ("last year", Period::LastYear),
        ("yesterday", Period::Yesterday),
        ("today", Period::Today),
    ];
    let lower = q.to_lowercase();
    for (w, p) in WORDS {
        if let Some(i) = lower.find(w) {
            let p = match *w {
                "前天" => {
                    let d = Civil::from_day_number(today.day_number() - 2);
                    Period::Custom(d, d)
                }
                "上上个月" => Period::Custom(EPOCH, EPOCH),
                _ => *p,
            };
            // two cycles back needs the cycle start, which only `resolve`
            // has; it is marked and finished in `parse_offline`
            return (cut(i, i + w.len()), p);
        }
    }
    if let Some(c) = m.captures(q) {
        if let Some(mo) = count_of(&c[1]).filter(|m| (1..=12).contains(m)) {
            let mo = mo as i32 - 1;
            // a month still ahead this year is last year's
            let y = if mo > today.m { today.y - 1 } else { today.y };
            let g = c.get(0).expect("0");
            return (cut(g.start(), g.end()), Period::Month(y, mo));
        }
    }
    (q.to_string(), Period::ThisMonth)
}

/// Read a question on the phone.
pub fn parse_offline(question: &str, today: Civil, cycle_start: i32, custom: Custom) -> AskQuery {
    static INC: OnceLock<Regex> = OnceLock::new();
    static COUNT: OnceLock<Regex> = OnceLock::new();
    static AVG_ENTRY: OnceLock<Regex> = OnceLock::new();
    static AVG: OnceLock<Regex> = OnceLock::new();
    static MAX: OnceLock<Regex> = OnceLock::new();
    static BY_CAT: OnceLock<Regex> = OnceLock::new();
    static BY_DAY: OnceLock<Regex> = OnceLock::new();
    static BY_MONTH: OnceLock<Regex> = OnceLock::new();
    static NOISE: OnceLock<Regex> = OnceLock::new();

    let q = half_width(question.trim());
    let lower = q.to_lowercase();
    let (rest, period) = take_period(&lower, today);
    let (mut from, mut to) = resolve(period, today, cycle_start);
    if period == Period::Custom(EPOCH, EPOCH) {
        // 上上个月
        let r = cycle_range(shift_cycle(today, -2, cycle_start), cycle_start);
        from = r.start;
        to = Civil::from_day_number(r.end.day_number() - 1);
    }

    let io = if re(&INC, "收入|进账|赚|挣|工资|奖金|到账|income|earn").is_match(&rest) {
        Io::Inc
    } else {
        Io::Exp
    };
    let metric = if re(&COUNT, "几笔|多少笔|几次|多少次|笔数|次数|how many").is_match(&rest)
    {
        Metric::Count
    } else if re(&AVG_ENTRY, "平均每笔|平均一笔|每笔平均|客单").is_match(&rest) {
        Metric::AvgEntry
    } else if re(&AVG, "平均|日均|average").is_match(&rest) {
        Metric::AvgDay
    } else if re(&MAX, "最大|最贵|最多的一笔|单笔最|biggest|largest").is_match(&rest) {
        Metric::Max
    } else {
        Metric::Sum
    };
    let group = if re(&BY_CAT, "哪类|哪个分类|什么分类|哪些分类|各分类|每个分类|分类|哪方面|花在哪|都花在|在哪|哪里|哪儿|by category").is_match(&rest) {
        Group::Category
    } else if re(&BY_DAY, "每天|每日|哪天|哪一天|逐日|by day|each day").is_match(&rest) && metric != Metric::AvgDay {
        Group::Day
    } else if re(&BY_MONTH, "每月|每个月|哪个月|逐月|by month").is_match(&rest) {
        Group::Month
    } else {
        Group::None
    };

    // The categories the question names by name, and what is left of it.
    let mut cats = Vec::new();
    let mut left = rest.clone();
    for c in all_cats(io, custom.of(io)) {
        for name in [c.zh.to_lowercase(), c.en.to_lowercase()] {
            if name.chars().count() >= 2 && left.contains(&name) {
                if !cats.contains(&c.k) {
                    cats.push(c.k.clone());
                }
                left = left.replace(&name, " ");
            }
        }
    }
    let noise = re(
        &NOISE,
        r"几笔|多少笔|几次|多少次|笔数|次数|平均每笔|平均一笔|每笔平均|客单|平均|日均|最大|最贵|最多的一笔|单笔最|哪类|哪个分类|什么分类|哪些分类|各分类|每个分类|分类|哪方面|花在哪|都花在|在哪|哪里|哪儿|每天|每日|哪天|哪一天|逐日|每月|每个月|哪个月|逐月|花了多少钱|花了多少|花多少|多少钱|多少|花了|花费|花在|花|钱|块|最多|最少|为什么|什么|怎么|哪|得|一笔|一次|笔|次|消费|支出|开销|收入|进账|赚了|赚|挣了|挣|到账|一共|总共|共|我的|我|在|了|的|是|有|吗|呢|啊|呀|吧|和|跟|都|给|用|[?？。，,!！]|\b(?:what|how much|did|i|spend|spent|on|in|the|much|my)\b",
    );
    let keyword = noise
        .replace_all(&left, " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    AskQuery {
        from,
        to,
        io,
        cats,
        keyword,
        group,
        metric,
    }
}

/// A model's query, checked: the period resolved here, the categories resolved
/// to keys that exist, anything unrecognised dropped rather than guessed.
pub fn parse_reply(
    content: &str,
    today: Civil,
    cycle_start: i32,
    custom: Custom,
) -> Option<AskQuery> {
    let v = extract_json(content)?;
    if !matches!(v, Value::Obj(_)) {
        return None;
    }
    let io = match text_in(v.get("io")).as_str() {
        "inc" | "income" => Io::Inc,
        _ => Io::Exp,
    };
    let period = match text_in(v.get("period")).as_str() {
        "today" => Period::Today,
        "yesterday" => Period::Yesterday,
        "this_week" => Period::ThisWeek,
        "last_week" => Period::LastWeek,
        "last_month" => Period::LastMonth,
        "this_year" => Period::ThisYear,
        "last_year" => Period::LastYear,
        "all" => Period::All,
        "last_n_days" => Period::LastDays(number_in(v.get("n")).map_or(7, |n| n as i64)),
        "custom" => match (
            parse_iso_date(&text_in(v.get("from"))),
            parse_iso_date(&text_in(v.get("to"))),
        ) {
            (Some(a), Some(b)) => Period::Custom(a, b),
            (Some(a), None) => Period::Custom(a, today),
            _ => Period::ThisMonth,
        },
        _ => Period::ThisMonth,
    };
    let (from, to) = resolve(period, today, cycle_start);
    let cats = match v.get("categories") {
        Some(Value::Arr(a)) => {
            let mut out: Vec<String> = Vec::new();
            for label in a {
                if let Some(k) = resolve_category(&text_in(Some(label)), io, custom) {
                    if !out.contains(&k) {
                        out.push(k);
                    }
                }
            }
            out
        }
        _ => Vec::new(),
    };
    Some(AskQuery {
        from,
        to,
        io,
        cats,
        keyword: text_in(v.get("keyword")).chars().take(40).collect(),
        group: Group::parse(&text_in(v.get("group"))),
        metric: Metric::parse(&text_in(v.get("metric"))),
    })
}

/* --------------------------------------------------------------- the run -- */

/// One live row and the day it fell on — the day is the platform's to decide.
pub struct AskRow<'a> {
    pub entry: &'a Entry,
    pub day: Civil,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GroupRow {
    /// A category key, `y-m-d` or `y-m`.
    pub key: String,
    pub amount: f64,
    pub count: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskAnswer {
    /// The query as run — after a keyword that matched nothing fell back to
    /// the category it names.
    pub query: AskQuery,
    /// The measure asked for.
    pub value: f64,
    pub total: f64,
    pub count: usize,
    /// Days in the range, up to today.
    pub days: i64,
    /// Everything on this side in the range, for the share.
    pub side_total: f64,
    /// `total / side_total` when the query narrowed by category or keyword.
    pub share: Option<f64>,
    pub groups: Vec<GroupRow>,
    /// The largest matching rows, by id, most first.
    pub top: Vec<String>,
    /// The keyword matched nothing, and the category it names was used.
    pub fell_back: bool,
}

fn run_once<'r, 'a>(
    q: &AskQuery,
    rows: &'r [AskRow<'a>],
    custom: Custom,
    zh: bool,
) -> Vec<&'r AskRow<'a>> {
    rows.iter()
        .filter(|r| r.day >= q.from && r.day <= q.to)
        .filter(|r| r.entry.io.unwrap_or(Io::Exp) == q.io)
        .filter(|r| q.cats.is_empty() || q.cats.contains(&r.entry.cat))
        .filter(|r| {
            q.keyword.is_empty() || matches_search(r.entry, &q.keyword, custom.of(q.io), zh)
        })
        .collect()
}

/// Run a query over the ledger.
pub fn run(q: &AskQuery, rows: &[AskRow], today: Civil, custom: Custom, zh: bool) -> AskAnswer {
    let mut query = q.clone();
    let mut hits = run_once(&query, rows, custom, zh);
    let mut fell_back = false;
    // 外卖花了多少, in a ledger whose notes never say 外卖: the question was
    // about the category the word names, not about a word nobody typed
    if hits.is_empty() && !query.keyword.is_empty() {
        let k = map_category(query.io, None, Some(&query.keyword), custom.of(query.io));
        if k != "other" && !query.cats.contains(&k) {
            let mut tried = query.clone();
            tried.cats = vec![k];
            tried.keyword.clear();
            let again = run_once(&tried, rows, custom, zh);
            if !again.is_empty() {
                query = tried;
                hits = again;
                fell_back = true;
            }
        }
    }

    let total: f64 = hits.iter().map(|r| r.entry.amt).sum();
    let count = hits.len();
    let last = if query.to < today { query.to } else { today };
    let days = (last.day_number() - query.from.day_number() + 1).max(1);
    let side_total: f64 = rows
        .iter()
        .filter(|r| r.day >= query.from && r.day <= query.to)
        .filter(|r| r.entry.io.unwrap_or(Io::Exp) == query.io)
        .map(|r| r.entry.amt)
        .sum();
    let narrowed = !query.cats.is_empty() || !query.keyword.is_empty();
    let share = (narrowed && side_total > 0.0).then(|| total / side_total);

    let mut top: Vec<&&AskRow> = hits.iter().collect();
    top.sort_by(|a, b| b.entry.amt.total_cmp(&a.entry.amt));
    let max = top.first().map_or(0.0, |r| r.entry.amt);

    let key_of = |r: &AskRow| match query.group {
        Group::Category => r.entry.cat.clone(),
        Group::Day => format!("{}-{}-{}", r.day.y, r.day.m + 1, r.day.d),
        Group::Month => format!("{}-{}", r.day.y, r.day.m + 1),
        Group::None => String::new(),
    };
    let mut groups: Vec<GroupRow> = Vec::new();
    if query.group != Group::None {
        for r in &hits {
            let k = key_of(r);
            match groups.iter_mut().find(|g| g.key == k) {
                Some(g) => {
                    g.amount += r.entry.amt;
                    g.count += 1;
                }
                None => groups.push(GroupRow {
                    key: k,
                    amount: r.entry.amt,
                    count: 1,
                }),
            }
        }
        for g in &mut groups {
            g.amount = crate::num::round2(g.amount);
        }
        match query.group {
            Group::Category => groups.sort_by(|a, b| b.amount.total_cmp(&a.amount)),
            _ => groups.sort_by_key(|g| {
                // by date, which the keys spell without padding
                let p: Vec<i64> = g.key.split('-').map(|x| x.parse().unwrap_or(0)).collect();
                p.iter().fold(0, |acc, x| acc * 100 + x)
            }),
        }
    }

    let value = match query.metric {
        Metric::Sum => total,
        Metric::Count => count as f64,
        Metric::AvgDay => total / days as f64,
        Metric::AvgEntry => {
            if count == 0 {
                0.0
            } else {
                total / count as f64
            }
        }
        Metric::Max => max,
    };

    AskAnswer {
        query,
        value: crate::num::round2(value),
        total: crate::num::round2(total),
        count,
        days,
        side_total: crate::num::round2(side_total),
        share,
        groups,
        top: top.iter().take(5).map(|r| r.entry.id.clone()).collect(),
        fell_back,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn today() -> Civil {
        Civil::new(2026, 8, 23) // Wednesday 23 September 2026
    }

    fn ask(q: &str) -> AskQuery {
        parse_offline(q, today(), 1, Custom::default())
    }

    fn day(y: i32, m: i32, d: i32) -> Civil {
        Civil::new(y, m - 1, d)
    }

    #[test]
    fn the_period_a_question_names() {
        assert_eq!(
            (ask("这个月花了多少").from, ask("这个月花了多少").to),
            (day(2026, 9, 1), day(2026, 9, 30))
        );
        assert_eq!(ask("上个月花了多少").from, day(2026, 8, 1));
        assert_eq!(ask("上个月花了多少").to, day(2026, 8, 31));
        assert_eq!(ask("上上个月").from, day(2026, 7, 1));
        assert_eq!((ask("今天").from, ask("今天").to), (today(), today()));
        assert_eq!(ask("昨天吃饭").from, day(2026, 9, 22));
        assert_eq!(ask("上周").from, day(2026, 9, 14));
        assert_eq!(ask("上周").to, day(2026, 9, 20));
        assert_eq!(ask("本周").from, day(2026, 9, 21));
        assert_eq!(ask("最近7天").from, day(2026, 9, 17));
        assert_eq!(ask("近三天").from, day(2026, 9, 21));
        assert_eq!(ask("最近一周").from, day(2026, 9, 17));
        assert_eq!(ask("今年").from, day(2026, 1, 1));
        assert_eq!(ask("去年").to, day(2025, 12, 31));
        assert_eq!(ask("3月").from, day(2026, 3, 1));
        assert_eq!(ask("3月").to, day(2026, 3, 31));
        assert_eq!(
            ask("十二月").from,
            day(2025, 12, 1),
            "a month still ahead is last year's"
        );
        assert_eq!(ask("2025年2月").to, day(2025, 2, 28));
        assert_eq!(ask("一共花了多少").from, EPOCH);
        assert_eq!(
            ask("花了多少").from,
            day(2026, 9, 1),
            "nothing said: this cycle"
        );
    }

    #[test]
    fn this_month_is_the_cycle() {
        let q = parse_offline("这个月", today(), 10, Custom::default());
        assert_eq!((q.from, q.to), (day(2026, 9, 10), day(2026, 10, 9)));
        let q = parse_offline("上个月", today(), 25, Custom::default());
        assert_eq!((q.from, q.to), (day(2026, 7, 25), day(2026, 8, 24)));
    }

    #[test]
    fn what_to_measure_and_how_to_group() {
        assert_eq!(ask("这个月花了几笔").metric, Metric::Count);
        assert_eq!(ask("平均每天花多少").metric, Metric::AvgDay);
        assert_eq!(
            ask("平均每天花多少").group,
            Group::None,
            "每天 in an average is not a grouping"
        );
        assert_eq!(ask("平均每笔多少").metric, Metric::AvgEntry);
        assert_eq!(ask("最贵的一笔是什么").metric, Metric::Max);
        assert_eq!(ask("钱都花在哪了").group, Group::Category);
        assert_eq!(ask("最近7天每天花多少").group, Group::Day);
        assert_eq!(ask("今年每个月花多少").group, Group::Month);
        assert_eq!(ask("这个月收入多少").io, Io::Inc);
        assert_eq!(ask("这个月花了多少").io, Io::Exp);
    }

    #[test]
    fn categories_by_name_and_what_is_left_as_a_keyword() {
        let q = ask("上个月餐饮花了多少");
        assert_eq!(q.cats, vec!["food".to_string()]);
        assert_eq!(q.keyword, "");
        let q = ask("这个月外卖花了多少钱？");
        assert!(q.cats.is_empty());
        assert_eq!(q.keyword, "外卖");
        let q = ask("最近一个月打车一共多少");
        assert_eq!(q.keyword, "打车");
        assert_eq!(
            ask("钱都花在哪了").keyword,
            "",
            "钱 is not a thing to look for"
        );
        assert_eq!(ask("这个月最贵的一笔").keyword, "", "nor is 一笔");
    }

    fn e(id: &str, io: Io, cat: &str, amt: f64, note: &str) -> Entry {
        Entry {
            id: id.into(),
            io: Some(io),
            cat: cat.into(),
            amt,
            note: (!note.is_empty()).then(|| note.to_string()),
            ..Default::default()
        }
    }

    #[test]
    fn a_query_is_run_over_the_ledger() {
        let es = [
            e("a", Io::Exp, "food", 30.0, "外卖"),
            e("b", Io::Exp, "food", 20.0, "食堂"),
            e("c", Io::Exp, "trans", 12.0, "打车"),
            e("d", Io::Inc, "salary", 9000.0, ""),
            e("old", Io::Exp, "food", 99.0, "外卖"),
        ];
        let days = [
            day(2026, 9, 20),
            day(2026, 9, 21),
            day(2026, 9, 21),
            day(2026, 9, 5),
            day(2026, 8, 30),
        ];
        let rows: Vec<AskRow> = es
            .iter()
            .zip(days)
            .map(|(entry, day)| AskRow { entry, day })
            .collect();
        let c = Custom::default();

        let a = run(&ask("这个月花了多少"), &rows, today(), c, true);
        assert_eq!((a.value, a.count), (62.0, 3));
        assert_eq!(a.share, None, "the whole side: no share");

        let a = run(&ask("这个月外卖花了多少"), &rows, today(), c, true);
        assert_eq!(
            (a.value, a.count),
            (30.0, 1),
            "the note says 外卖; last month's does not count"
        );
        assert_eq!(a.share.map(|s| (s * 100.0).round()), Some(48.0));
        assert!(!a.fell_back);

        let a = run(&ask("这个月餐饮几笔"), &rows, today(), c, true);
        assert_eq!(a.value, 2.0);

        let a = run(&ask("钱都花在哪了"), &rows, today(), c, true);
        assert_eq!(
            a.groups
                .iter()
                .map(|g| (g.key.as_str(), g.amount))
                .collect::<Vec<_>>(),
            vec![("food", 50.0), ("trans", 12.0)]
        );

        let a = run(&ask("这个月每天花多少"), &rows, today(), c, true);
        assert_eq!(
            a.groups.iter().map(|g| g.key.as_str()).collect::<Vec<_>>(),
            vec!["2026-9-20", "2026-9-21"]
        );

        let a = run(&ask("这个月收入多少"), &rows, today(), c, true);
        assert_eq!(a.value, 9000.0);

        let a = run(&ask("这个月最贵的一笔"), &rows, today(), c, true);
        assert_eq!((a.value, a.top[0].as_str()), (30.0, "a"));

        let a = run(&ask("这个月平均每天花多少"), &rows, today(), c, true);
        assert_eq!(a.days, 23, "up to today, not to the end of the cycle");
        assert_eq!(a.value, crate::num::round2(62.0 / 23.0));
    }

    #[test]
    fn a_word_nobody_typed_falls_back_to_its_category() {
        let es = [
            e("a", Io::Exp, "food", 30.0, "午饭"),
            e("b", Io::Exp, "trans", 5.0, ""),
        ];
        let rows: Vec<AskRow> = es
            .iter()
            .map(|entry| AskRow {
                entry,
                day: today(),
            })
            .collect();
        let a = run(
            &ask("这个月咖啡花了多少"),
            &rows,
            today(),
            Custom::default(),
            true,
        );
        assert!(a.fell_back, "no note says 咖啡, and 咖啡 is 餐饮");
        assert_eq!(a.query.cats, vec!["food".to_string()]);
        assert_eq!(a.value, 30.0);
    }

    #[test]
    fn a_models_query_is_checked() {
        let c = Custom::default();
        let q = parse_reply(
            r#"{"period":"last_month","io":"exp","categories":["餐饮","没有这个"],"keyword":"外卖","group":"category","metric":"sum"}"#,
            today(),
            1,
            c,
        )
        .unwrap();
        assert_eq!(
            (q.from, q.to),
            (day(2026, 8, 1), day(2026, 8, 31)),
            "the cycle, resolved here"
        );
        assert_eq!(
            q.cats,
            vec!["food".to_string()],
            "an unknown label is dropped"
        );
        assert_eq!(q.group, Group::Category);

        let q = parse_reply(
            r#"{"period":"custom","from":"2026-09-10","to":"2026-09-01"}"#,
            today(),
            1,
            c,
        )
        .unwrap();
        assert_eq!(
            (q.from, q.to),
            (day(2026, 9, 1), day(2026, 9, 10)),
            "a backwards range is turned round"
        );

        let q = parse_reply(
            r#"{"period":"last_n_days","n":3,"metric":"avg_day"}"#,
            today(),
            1,
            c,
        )
        .unwrap();
        assert_eq!(q.from, day(2026, 9, 21));
        assert_eq!(q.metric, Metric::AvgDay);

        let q = parse_reply(
            r#"{"period":"whenever","metric":"magic","group":"planet"}"#,
            today(),
            1,
            c,
        )
        .unwrap();
        assert_eq!(
            (q.metric, q.group),
            (Metric::Sum, Group::None),
            "unknowns take the default"
        );
        assert_eq!(q.from, day(2026, 9, 1));

        assert_eq!(parse_reply("no idea", today(), 1, c), None);
        assert_eq!(parse_reply("[1,2]", today(), 1, c), None);
    }
}
