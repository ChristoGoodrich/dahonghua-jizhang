//! Reading an Alipay or WeChat bill export.
//!
//! Ported from `src/domain/billParse.ts` — the text half. Byte-level decoding
//! (`decodeBillText`, and the 72 KB GBK table `encoding.ts` falls back to) is
//! deliberately not here: that table is auto-generated from the platform's own
//! `TextDecoder` so the JS fallback matches it exactly, and the Rust answer is
//! a crate like `encoding_rs` rather than a hand-copied table. The TypeScript
//! already splits at the same seam — bytes go in one side, text comes out, and
//! `parseBills` starts from text.
//!
//! Dates come back as civil components rather than epoch milliseconds, for the
//! reason `civil.rs` gives: `new Date(y, m, d, h, mi, s)` is local time, and
//! local time is a question only the device can answer.

use crate::civil::Civil;
use crate::entry::Io;
use crate::jsstr::js_trim;
use crate::num::round2;
use regex_lite::Regex;
use std::sync::OnceLock;

/// Which wallet produced the file. Only affects display and a couple of
/// defaults — the column mapping is keyword-driven either way.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BillSource {
    Alipay,
    Wechat,
    Generic,
}

impl BillSource {
    pub fn as_str(self) -> &'static str {
        match self {
            BillSource::Alipay => "alipay",
            BillSource::Wechat => "wechat",
            BillSource::Generic => "generic",
        }
    }
}

/// A wall-clock instant as the file wrote it. The platform turns this into the
/// epoch millisecond an entry is stamped with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CivilTime {
    pub date: Civil,
    pub h: u32,
    pub mi: u32,
    pub s: u32,
}

/// A normalised row lifted out of the CSV, before it becomes an entry.
#[derive(Debug, Clone, PartialEq)]
pub struct RawBill {
    pub at: CivilTime,
    pub io: Io,
    /// Always positive, in the file's currency, which is assumed to be base.
    pub amt: f64,
    /// The wallet's own category label.
    pub src_cat: Option<String>,
    pub party: Option<String>,
    pub desc: Option<String>,
    pub method: Option<String>,
    pub status: Option<String>,
}

/// Header index per field. `-1` means the column is absent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ColumnMap {
    pub ts: i32,
    pub amt: i32,
    pub io: i32,
    pub src_cat: i32,
    pub party: i32,
    pub desc: i32,
    pub method: i32,
    pub status: i32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RowError {
    /// 1-indexed line number in the original CSV.
    pub row: usize,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParseResult {
    pub source: BillSource,
    /// Index into the raw rows; `-1` when no header was found.
    pub header_row: i32,
    pub columns: Option<ColumnMap>,
    pub bills: Vec<RawBill>,
    /// Data rows seen below the header.
    pub data_rows: usize,
    /// Data rows that were unusable.
    pub skipped: usize,
    pub errors: Vec<RowError>,
}

/* ----------------------------------------------------------- CSV parsing -- */

/// Parse CSV text into a matrix.
///
/// Handles the RFC-4180 essentials the wallet exports rely on: quoted fields,
/// embedded commas and newlines, doubled quotes, and CRLF. A leading BOM is
/// stripped — WeChat writes one.
pub fn parse_csv(text: &str) -> Vec<Vec<String>> {
    let src: Vec<char> = text
        .strip_prefix('\u{feff}')
        .unwrap_or(text)
        .chars()
        .collect();
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;

    let mut i = 0;
    while i < src.len() {
        let c = src[i];
        if in_quotes {
            if c == '"' {
                if src.get(i + 1) == Some(&'"') {
                    field.push('"'); // doubled quote is one literal quote
                    i += 1;
                } else {
                    in_quotes = false;
                }
            } else {
                field.push(c);
            }
            i += 1;
            continue;
        }
        match c {
            '"' => in_quotes = true,
            ',' => {
                row.push(std::mem::take(&mut field));
            }
            // swallowed; the \n that follows ends the row
            '\r' => {}
            '\n' => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            _ => field.push(c),
        }
        i += 1;
    }
    // a file may end without a newline
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows
}

/* ------------------------------------------- header detection + mapping -- */

// Keyword to field. Order matters: the first keyword that matches a header cell
// wins, so the specific labels come before the generic ones.
const TS_KEYS: &[&str] = &["交易时间", "交易创建时间", "付款时间", "时间", "日期"];
const AMT_KEYS: &[&str] = &["金额", "发生金额", "交易金额"];
const IO_KEYS: &[&str] = &["收/支", "收支", "收/付"];
const CAT_KEYS: &[&str] = &["交易分类", "交易类型", "类型", "分类"];
const PARTY_KEYS: &[&str] = &["交易对方", "对方", "商户名称"];
const DESC_KEYS: &[&str] = &["商品说明", "商品名称", "商品", "说明", "摘要", "备注"];
const METHOD_KEYS: &[&str] = &["收/付款方式", "付款方式", "支付方式", "收款方式"];
const STATUS_KEYS: &[&str] = &["交易状态", "当前状态", "状态"];

fn find_col(header: &[String], keys: &[&str]) -> i32 {
    for k in keys {
        if let Some(i) = header.iter().position(|h| js_trim(h).contains(k)) {
            return i as i32;
        }
    }
    -1
}

/// A header row has a time-ish column, a 收/支 column and an amount column.
fn is_header_row(row: &[String]) -> bool {
    find_col(row, TS_KEYS) >= 0 && find_col(row, IO_KEYS) >= 0 && find_col(row, AMT_KEYS) >= 0
}

/// Locate the header, skipping the export's preamble. `-1` when not found.
pub fn find_header_row(rows: &[Vec<String>]) -> i32 {
    rows.iter()
        .position(|r| is_header_row(r))
        .map_or(-1, |i| i as i32)
}

fn wallet_re() -> &'static (Regex, Regex) {
    static R: OnceLock<(Regex, Regex)> = OnceLock::new();
    R.get_or_init(|| {
        (
            Regex::new("(?i)支付宝|alipay").expect("pattern compiles"),
            Regex::new("(?i)微信|wechat|weixin|财付通").expect("pattern compiles"),
        )
    })
}

/// Guess which wallet produced the file, from the first 25 rows.
pub fn detect_source(rows: &[Vec<String>]) -> BillSource {
    let head: String = rows
        .iter()
        .take(25)
        .map(|r| r.concat())
        .collect::<Vec<_>>()
        .join("\n");
    let (alipay, wechat) = wallet_re();
    if alipay.is_match(&head) {
        BillSource::Alipay
    } else if wechat.is_match(&head) {
        BillSource::Wechat
    } else {
        BillSource::Generic
    }
}

/// Map header cells to fields. `None` when time, amount or 收/支 is missing —
/// without those three a row cannot become an entry at all.
pub fn auto_map(header: &[String]) -> Option<ColumnMap> {
    let map = ColumnMap {
        ts: find_col(header, TS_KEYS),
        amt: find_col(header, AMT_KEYS),
        io: find_col(header, IO_KEYS),
        src_cat: find_col(header, CAT_KEYS),
        party: find_col(header, PARTY_KEYS),
        desc: find_col(header, DESC_KEYS),
        method: find_col(header, METHOD_KEYS),
        status: find_col(header, STATUS_KEYS),
    };
    (map.ts >= 0 && map.amt >= 0 && map.io >= 0).then_some(map)
}

/* ---------------------------------------------------------- value parsers */

fn date_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(
            r"([0-9]{4})[-/年.]([0-9]{1,2})[-/月.]([0-9]{1,2})日?(?:[ T]([0-9]{1,2}):([0-9]{1,2})(?::([0-9]{1,2}))?)?",
        )
        .expect("pattern compiles")
    })
}

/// Parse a wallet datetime. Accepts `2024-01-05 12:30:00`, `2024/1/5 8:00`,
/// `2024-01-05` and `2024年1月5日 12:30`.
///
/// Out-of-range components are **not** rejected. `new Date(2024, 12, 32)` rolls
/// over rather than failing, and month 13 day 40 is a date the TypeScript
/// happily produces — [`Civil::new`] rolls the same way. Two further pieces of
/// `new Date(y, m, d, h, mi, s)` had to be reproduced here, both found by the
/// corpus rather than by reading:
///
/// * **Years 0 through 99 mean 1900 through 1999.** `MakeFullYear` in the spec:
///   the multi-argument constructor still carries the two-digit-year rule, so a
///   corrupt row reading `0001-01-05` becomes 1901 in the shipping app. The
///   four-digit year the pattern demands does not put this out of reach —
///   `0099` is four digits, and `10000-1-5` backtracks into `0000`.
///
/// * **Time components carry into the date.** `MakeTime` multiplies rather than
///   clamps, so hour 24 is the next day at midnight and second 99 is a minute
///   and 39 seconds later. Ninety-nine of each is the pattern's ceiling, four
///   days at most.
///
/// The carry is wall-clock arithmetic, which is where this crate's boundary
/// sits. If the wall time it lands on does not exist — a zone whose clocks
/// spring forward at midnight — the platform resolves that when it converts to
/// an instant, exactly as it does for every other date this crate hands over.
pub fn parse_date(s: Option<&str>) -> Option<CivilTime> {
    let s = js_trim(s?);
    let caps = date_re().captures(s)?;
    let g = |i: usize| caps.get(i).map(|m| m.as_str().parse::<i32>().unwrap_or(0));
    let y = g(1)?;
    let mo = g(2)?;
    let d = g(3)?;
    let (h, mi, sec) = (g(4).unwrap_or(0), g(5).unwrap_or(0), g(6).unwrap_or(0));

    let y = if (0..=99).contains(&y) { 1900 + y } else { y };
    let secs = h * 3600 + mi * 60 + sec;
    let (carry, rest) = (secs / 86_400, secs % 86_400);

    Some(CivilTime {
        // months are 1-based in the file and 0-based in the calendar
        date: Civil::new(y, mo - 1, d + carry),
        h: (rest / 3600) as u32,
        mi: (rest % 3600 / 60) as u32,
        s: (rest % 60) as u32,
    })
}

fn amount_junk() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"[^0-9.\-]").expect("pattern compiles"))
}

/// Parse an amount cell, tolerating currency symbols, thousands separators, a
/// leading sign and stray spaces. Returns the magnitude, always at least zero.
///
/// The strip is `[^\d.\-]` with JavaScript's ASCII `\d`, so a full-width ９ is
/// removed rather than read as a digit — same reasoning as `notif.rs`.
pub fn parse_amount(s: Option<&str>) -> Option<f64> {
    let s = s?;
    let cleaned = amount_junk().replace_all(s, "");
    if cleaned.is_empty() || cleaned == "-" || cleaned == "." {
        return None;
    }
    let n = parse_float_prefix(&cleaned);
    n.is_finite().then(|| round2(n).abs())
}

/// JavaScript `parseFloat`: the longest leading run that parses, else 0.
///
/// Reachable here because the strip leaves things like `1-2` and `1.2.3`
/// behind, which `parseFloat` reads as 1 and 1.2 rather than rejecting.
fn parse_float_prefix(s: &str) -> f64 {
    let mut best = 0.0_f64;
    let mut any = false;
    for (i, ch) in s.char_indices() {
        if !matches!(ch, '0'..='9' | '.' | '-') {
            break;
        }
        if let Ok(v) = s[..=i].parse::<f64>() {
            best = v;
            any = true;
        }
    }
    if any {
        best
    } else {
        f64::NAN
    }
}

/// Interpret the 收/支 cell. 不计收支, blank and `/` all mean "not a movement".
pub fn parse_io(s: Option<&str>) -> Option<Io> {
    let s = s?;
    if s.is_empty() {
        return None;
    }
    if s.contains("支出") || s.to_lowercase().contains("expense") {
        return Some(Io::Exp);
    }
    if s.contains("收入") || s.to_lowercase().contains("income") {
        return Some(Io::Inc);
    }
    None
}

/// A transaction status meaning the money never actually moved.
fn dead_status() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new("关闭|失败|退款成功|已退款|全额退款|冻结|解冻").expect("pattern compiles")
    })
}

/* ----------------------------------------------------------- the pipeline */

fn cell(row: &[String], i: i32) -> Option<&str> {
    if i < 0 {
        return None;
    }
    row.get(i as usize).map(|s| s.as_str())
}

/// Parse CSV text into normalised bills. No store access, no dedup.
pub fn parse_bills(text: &str) -> ParseResult {
    let rows = parse_csv(text);
    let source = detect_source(&rows);
    let header_row = find_header_row(&rows);
    if header_row < 0 {
        return ParseResult {
            source,
            header_row: -1,
            columns: None,
            bills: vec![],
            data_rows: 0,
            skipped: 0,
            errors: vec![],
        };
    }
    let columns = match auto_map(&rows[header_row as usize]) {
        Some(c) => c,
        None => {
            return ParseResult {
                source,
                header_row,
                columns: None,
                bills: vec![],
                data_rows: 0,
                skipped: 0,
                errors: vec![],
            }
        }
    };

    let mut bills = Vec::new();
    let mut errors = Vec::new();
    let mut data_rows = 0;
    let mut skipped = 0;

    for (r, row) in rows.iter().enumerate().skip(header_row as usize + 1) {
        if row.is_empty() || row.iter().all(|c| js_trim(c).is_empty()) {
            continue; // blank line
        }
        data_rows += 1;

        let io = parse_io(cell(row, columns.io));
        let amt = parse_amount(cell(row, columns.amt));
        let at = parse_date(cell(row, columns.ts));
        let status = cell(row, columns.status);
        let dead = status.is_some_and(|s| !s.is_empty() && dead_status().is_match(s));

        if io.is_none() || amt.is_none_or(|a| a <= 0.0) || at.is_none() || dead {
            skipped += 1;
            let reason = if dead {
                format!("交易状态: {}", js_trim(status.unwrap_or("")))
            } else if io.is_none() {
                "不计收支或收/支字段为空".to_string()
            } else if at.is_none() {
                "无法解析交易时间".to_string()
            } else {
                "金额无效或为零".to_string()
            };
            // r is the 0-indexed CSV row; +1 makes it a human line number
            errors.push(RowError { row: r + 1, reason });
            continue;
        }

        let trimmed = |i: i32| {
            cell(row, i)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        };
        bills.push(RawBill {
            at: at.expect("checked above"),
            io: io.expect("checked above"),
            amt: amt.expect("checked above"),
            src_cat: trimmed(columns.src_cat),
            party: trimmed(columns.party),
            desc: trimmed(columns.desc),
            method: trimmed(columns.method),
            status: trimmed(columns.status),
        });
    }

    ParseResult {
        source,
        header_row,
        columns: Some(columns),
        bills,
        data_rows,
        skipped,
        errors,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows(text: &str) -> Vec<Vec<String>> {
        parse_csv(text)
    }

    #[test]
    fn plain_rows_split_on_commas_and_newlines() {
        assert_eq!(rows("a,b\nc,d"), vec![vec!["a", "b"], vec!["c", "d"]]);
    }

    #[test]
    fn crlf_is_handled() {
        assert_eq!(rows("a,b\r\nc,d\r\n"), vec![vec!["a", "b"], vec!["c", "d"]]);
    }

    #[test]
    fn a_quoted_field_may_contain_commas_and_newlines() {
        assert_eq!(rows("\"a,1\",b"), vec![vec!["a,1", "b"]]);
        assert_eq!(rows("\"a\nb\",c"), vec![vec!["a\nb", "c"]]);
    }

    #[test]
    fn a_doubled_quote_is_one_literal_quote() {
        assert_eq!(rows("\"say \"\"hi\"\"\",b"), vec![vec!["say \"hi\"", "b"]]);
    }

    #[test]
    fn a_leading_bom_is_stripped() {
        assert_eq!(rows("\u{feff}a,b"), vec![vec!["a", "b"]]);
    }

    #[test]
    fn a_file_ending_without_a_newline_keeps_its_last_row() {
        assert_eq!(rows("a,b"), vec![vec!["a", "b"]]);
    }

    #[test]
    fn empty_text_is_no_rows() {
        assert!(rows("").is_empty());
    }

    #[test]
    fn the_header_is_found_below_a_preamble() {
        let r =
            rows("支付宝交易记录\n导出时间,2026-01-01\n\n交易时间,收/支,金额\n2026-01-01,支出,35");
        assert_eq!(find_header_row(&r), 3);
    }

    #[test]
    fn a_row_missing_one_required_column_is_not_the_header() {
        let r = rows("交易时间,金额\n2026-01-01,35");
        assert_eq!(find_header_row(&r), -1);
    }

    #[test]
    fn the_wallet_is_guessed_from_the_preamble() {
        assert_eq!(
            detect_source(&rows("支付宝交易记录\na,b")),
            BillSource::Alipay
        );
        assert_eq!(
            detect_source(&rows("微信支付账单\na,b")),
            BillSource::Wechat
        );
        assert_eq!(
            detect_source(&rows("Alipay export\na,b")),
            BillSource::Alipay
        );
        assert_eq!(detect_source(&rows("some bank\na,b")), BillSource::Generic);
    }

    #[test]
    fn mapping_needs_time_amount_and_direction() {
        let header: Vec<String> = ["交易时间", "收/支", "金额", "交易对方"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let m = auto_map(&header).unwrap();
        assert_eq!((m.ts, m.io, m.amt, m.party), (0, 1, 2, 3));
        assert_eq!(m.desc, -1);

        let short: Vec<String> = ["交易时间", "金额"].iter().map(|s| s.to_string()).collect();
        assert!(auto_map(&short).is_none());
    }

    #[test]
    fn dates_come_back_as_civil_components() {
        let t = parse_date(Some("2024-01-05 12:30:45")).unwrap();
        assert_eq!(t.date, Civil::new(2024, 0, 5));
        assert_eq!((t.h, t.mi, t.s), (12, 30, 45));

        assert_eq!(
            parse_date(Some("2024/1/5 8:00")).unwrap().date,
            Civil::new(2024, 0, 5)
        );
        assert_eq!(
            parse_date(Some("2024年1月5日 12:30")).unwrap().date,
            Civil::new(2024, 0, 5)
        );
        assert_eq!(parse_date(Some("2024-01-05")).unwrap().h, 0);
        assert!(parse_date(Some("nothing")).is_none());
        assert!(parse_date(None).is_none());
    }

    #[test]
    fn an_out_of_range_date_rolls_over_rather_than_failing() {
        // new Date(2024, 12, 32) is 2025-02-01; Civil::new rolls the same way
        let t = parse_date(Some("2024-13-32")).unwrap();
        assert_eq!(t.date, Civil::new(2025, 1, 1));
    }

    #[test]
    fn a_year_under_a_hundred_means_the_twentieth_century() {
        // MakeFullYear: new Date(1, 0, 5) is 1901, not year 1
        assert_eq!(
            parse_date(Some("0001-01-05")).unwrap().date,
            Civil::new(1901, 0, 5)
        );
        assert_eq!(
            parse_date(Some("0099-01-05")).unwrap().date,
            Civil::new(1999, 0, 5)
        );
        assert_eq!(
            parse_date(Some("0100-01-05")).unwrap().date,
            Civil::new(100, 0, 5)
        );
        // the four-digit pattern backtracks into a leading zero run
        assert_eq!(
            parse_date(Some("10000-01-05")).unwrap().date,
            Civil::new(1900, 0, 5)
        );
    }

    #[test]
    fn out_of_range_time_carries_into_the_date() {
        // MakeTime multiplies rather than clamps
        let t = parse_date(Some("2026-01-20 24:00:00")).unwrap();
        assert_eq!((t.date, t.h), (Civil::new(2026, 0, 21), 0));

        let t = parse_date(Some("2026-01-20 12:30:99")).unwrap();
        assert_eq!((t.h, t.mi, t.s), (12, 31, 39));

        let t = parse_date(Some("2026-01-20 12:99")).unwrap();
        assert_eq!((t.h, t.mi), (13, 39));

        // the pattern's ceiling is 99 of each, which is four days and change
        let t = parse_date(Some("2026-01-20 99:99:99")).unwrap();
        assert_eq!(
            (t.date, t.h, t.mi, t.s),
            (Civil::new(2026, 0, 24), 4, 40, 39)
        );
    }

    #[test]
    fn amounts_tolerate_symbols_separators_and_signs() {
        assert_eq!(parse_amount(Some("¥1,234.56")), Some(1234.56));
        assert_eq!(parse_amount(Some("-35.00")), Some(35.0));
        assert_eq!(parse_amount(Some(" 12 ")), Some(12.0));
        assert_eq!(parse_amount(Some("0")), Some(0.0));
    }

    #[test]
    fn an_amount_with_nothing_numeric_is_rejected() {
        assert_eq!(parse_amount(Some("")), None);
        assert_eq!(parse_amount(Some("---")), None);
        assert_eq!(parse_amount(Some("abc")), None);
        assert_eq!(parse_amount(None), None);
    }

    #[test]
    fn a_full_width_digit_is_stripped_not_read() {
        // `[^\d.\-]` with JavaScript's ASCII \d
        assert_eq!(parse_amount(Some("３５")), None);
        assert_eq!(parse_amount(Some("3５")), Some(3.0));
    }

    #[test]
    fn direction_reads_the_chinese_or_the_english() {
        assert_eq!(parse_io(Some("支出")), Some(Io::Exp));
        assert_eq!(parse_io(Some("收入")), Some(Io::Inc));
        assert_eq!(parse_io(Some("Expense")), Some(Io::Exp));
        assert_eq!(parse_io(Some("不计收支")), None);
        assert_eq!(parse_io(Some("/")), None);
        assert_eq!(parse_io(Some("")), None);
    }

    const CSV: &str = "支付宝交易记录\n\
交易时间,交易分类,交易对方,商品说明,收/支,金额,交易状态\n\
2026-01-05 12:30:00,餐饮,肯德基,午餐,支出,35.50,交易成功\n\
2026-01-06 09:00:00,工资,公司,一月,收入,9000.00,交易成功\n\
2026-01-07 10:00:00,退款,商家,退货,收入,20.00,退款成功\n\
2026-01-08 10:00:00,其他,x,y,不计收支,5.00,交易成功\n\
,,,,,,\n";

    #[test]
    fn the_pipeline_lifts_usable_rows_and_explains_the_rest() {
        let r = parse_bills(CSV);
        assert_eq!(r.source, BillSource::Alipay);
        assert_eq!(r.header_row, 1);
        assert_eq!(r.data_rows, 4); // the all-blank row is not a data row
        assert_eq!(r.bills.len(), 2);
        assert_eq!(r.skipped, 2);

        assert_eq!(r.bills[0].amt, 35.5);
        assert_eq!(r.bills[0].io, Io::Exp);
        assert_eq!(r.bills[0].party.as_deref(), Some("肯德基"));
        assert_eq!(r.bills[0].src_cat.as_deref(), Some("餐饮"));

        // a refunded row never moved money
        assert!(r.errors.iter().any(|e| e.reason.starts_with("交易状态")));
        assert!(r.errors.iter().any(|e| e.reason.contains("不计收支")));
    }

    #[test]
    fn error_rows_are_numbered_for_a_human() {
        let r = parse_bills(CSV);
        // the 退款成功 row is the 5th line of the file
        assert_eq!(r.errors[0].row, 5);
    }

    #[test]
    fn a_file_with_no_header_yields_nothing_but_says_so() {
        let r = parse_bills("just,some,text\n1,2,3");
        assert_eq!(r.header_row, -1);
        assert!(r.columns.is_none());
        assert!(r.bills.is_empty());
    }
}
