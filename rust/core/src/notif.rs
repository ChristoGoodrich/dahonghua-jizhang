//! Reading a payment out of an Android notification.
//!
//! Ported from `src/domain/notifParse.ts`. This is the only module in the crate
//! that needed a dependency, and the reason is that its whole job is pattern
//! matching over Chinese text.
//!
//! **Every pattern is written with explicit character classes**, because the
//! two engines disagree about the shorthands in *both* directions:
//!
//! * `\d` in JavaScript without the `u` flag is ASCII `[0-9]` and nothing else.
//!   A Unicode-aware engine also matches full-width ０-９, which appear in real
//!   Chinese pushes — so inheriting the engine's opinion would parse amounts the
//!   app does not parse.
//! * `\s` runs the other way. JavaScript's includes U+00A0 and **U+3000, the
//!   ideographic space**, which is everywhere in Chinese text; `regex-lite`'s is
//!   ASCII-only. That one was not predicted — the parity corpus found it, on a
//!   merchant name that came back as `35元 返现` here and `35元` in the app.
//!
//! So [`JS_WS`] spells out JavaScript's definition and every pattern uses it.
//!
//! One difference is left in place because it cannot be removed: `.{1,20}` counts
//! UTF-16 code units in JavaScript and Unicode scalars here, so a merchant name
//! containing an emoji outside the basic plane is bounded slightly differently.
//! Every CJK character is one unit in both.

use crate::catalog::Category;
use crate::entry::Io;
use crate::keywords::map_category;
use regex_lite::Regex;
use std::sync::OnceLock;

/// What the notification listener handed over.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RawNotif {
    /// Native row id, used to acknowledge the queue.
    pub id: String,
    /// Source application id.
    pub pkg: String,
    pub title: Option<String>,
    pub text: Option<String>,
    /// `EXTRA_BIG_TEXT` — WeChat often puts the amount only here.
    pub big_text: Option<String>,
    /// Epoch milliseconds, from `Notification.postTime`.
    pub posted_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotifSource {
    Alipay,
    Wechat,
    Unionpay,
    Bank,
}

impl NotifSource {
    pub fn as_str(self) -> &'static str {
        match self {
            NotifSource::Alipay => "alipay",
            NotifSource::Wechat => "wechat",
            NotifSource::Unionpay => "unionpay",
            NotifSource::Bank => "bank",
        }
    }

    /// Shown when there is no merchant name to show instead.
    fn label(self) -> &'static str {
        match self {
            NotifSource::Alipay => "支付宝",
            NotifSource::Wechat => "微信支付",
            NotifSource::Unionpay => "云闪付",
            NotifSource::Bank => "银行卡",
        }
    }
}

/// A parsed payment. `confident` ones post to the ledger unattended; the rest
/// wait in the inbox for one tap.
#[derive(Debug, Clone, PartialEq)]
pub struct NotifCandidate {
    pub io: Io,
    pub amt: f64,
    pub merchant: Option<String>,
    pub source: NotifSource,
    pub posted_at: i64,
    pub confident: bool,
}

/// A candidate resolved against the user's categories, ready to become an entry.
#[derive(Debug, Clone, PartialEq)]
pub struct NotifEntryDraft {
    pub io: Io,
    pub amt: f64,
    pub cat: String,
    pub note: String,
    pub ts: i64,
    pub confident: bool,
}

/// JavaScript's `\s`, spelled out, from the ECMAScript grammar.
///
/// Rust turns these escapes into real characters before the regex engine
/// sees them, so no engine's idea of "whitespace" is involved.
pub const JS_WS: &str = "[\t\n\u{b}\u{c}\r \u{a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}]";

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("pattern compiles"))
}

/* ------------------------------------------------- 1. package whitelist ---- */

/// Verified-by-name wallets. Anything else has to earn its way in through the
/// bank-push shape below — an open policy would let every chat app through.
///
/// Package ids drift between app versions and channel builds, which is why the
/// inbox keeps unrecognised captures from these packages with their raw text
/// visible: that is how the real strings on a given phone become knowable. Add
/// what turns up rather than loosening the rules.
fn wallet_source(pkg: &str) -> Option<NotifSource> {
    Some(match pkg {
        "com.eg.android.AlipayGphone" | "com.alipay.android.app" => NotifSource::Alipay,
        "com.tencent.mm" => NotifSource::Wechat,
        "com.unionpay" => NotifSource::Unionpay,
        _ => return None,
    })
}

/// A bank push reads like an SMS: a masked card number, or the word for a kind
/// of card. Requiring that keeps unknown packages from feeding the ledger noise.
fn bank_shape() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(
        &R,
        &format!(r"尾号{JS_WS}*[0-9]{{3,4}}|信用卡|储蓄卡|借记卡"),
    )
}

pub fn classify_source(n: &RawNotif) -> Option<NotifSource> {
    if let Some(w) = wallet_source(&n.pkg) {
        return Some(w);
    }
    bank_shape()
        .is_match(&full_text(n))
        .then_some(NotifSource::Bank)
}

/* --------------------------------------------- 2. text assembly + noise ---- */

/// Everything the notification said, joined for scanning.
///
/// `big_text` usually repeats `text`; identical parts are collapsed so a
/// merchant pattern cannot match across the seam between two copies.
pub fn full_text(n: &RawNotif) -> String {
    let parts: Vec<&str> = [&n.title, &n.text, &n.big_text]
        .into_iter()
        .filter_map(|p| p.as_deref().map(str::trim))
        .filter(|p| !p.is_empty())
        .collect();
    let mut uniq: Vec<&str> = Vec::new();
    for p in parts {
        if !uniq.contains(&p) {
            uniq.push(p);
        }
    }
    uniq.join(" ")
}

/// Marketing, reminders and statements. These carry amounts, but no money moved.
fn noise() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(
        &R,
        "优惠券|立减|满减|红包封面|活动|积分|签到|领取|待还款|还款提醒|账单日|账单已出|即将到期|验证码|开通|升级|邀请",
    )
}

/// WeChat pushes chat messages from the same package as payments, and a message
/// like "老王: 350元那个我转你" would otherwise parse as a ¥350 expense.
fn wechat_payment() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, "微信支付|支付凭证|付款|收款|到账|退款")
}

/* ------------------------------------------------------------ 3. amount ---- */

/// An amount has to be marked as money — a currency prefix or a 元/块 suffix.
/// Bare digits are rejected on purpose: "尾号1234的卡" and "7月21日" both
/// contain numbers that are not amounts.
fn amount_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(
        &R,
        &format!(
            r"(?:¥|￥|RMB|人民币){JS_WS}*([0-9][0-9,]*(?:\.[0-9]{{1,2}})?)|([0-9][0-9,]*(?:\.[0-9]{{1,2}})?){JS_WS}*(?:元|块)"
        ),
    )
}

/// The first money-shaped number in the text.
pub fn parse_amount(text: &str) -> Option<f64> {
    for caps in amount_re().captures_iter(text) {
        let raw = caps
            .get(1)
            .or_else(|| caps.get(2))
            .map(|m| m.as_str().replace(',', ""))?;
        let n: f64 = raw.parse().ok()?;
        if n.is_finite() && n > 0.0 {
            return Some(crate::num::round2(n));
        }
    }
    None
}

/* --------------------------------------------------------- 4. direction ---- */

fn inc_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, "到账|收款|入账|退款|返现|已收款|收到|转入|发放")
}

fn exp_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, "付款|支付|消费|支出|扣款|扣费|已扣|转出|缴费")
}

/// Brand names contain the very verbs being scanned for — 支付宝 contains 支付 —
/// so a balance reminder titled 支付宝 would read as a payment and every
/// notification the app ever sends would become an expense.
fn brand_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, "支付宝|微信支付|云闪付|银联|财付通")
}

/// Income markers are checked first: they are the more specific vocabulary, and
/// a refund push ("退款¥32.00已原路返回") must not read as a payment.
pub fn parse_io(text: &str) -> Option<Io> {
    let body = brand_re().replace_all(text, " ");
    if inc_re().is_match(&body) {
        return Some(Io::Inc);
    }
    if exp_re().is_match(&body) {
        return Some(Io::Exp);
    }
    None
}

/* ---------------------------------------------------------- 5. merchant ---- */

/// Ordered most-specific first; the first pattern that captures a plausible
/// name wins. Names are bounded to twenty characters so a lazy match cannot
/// swallow a whole clause.
fn merchant_res() -> &'static Vec<Regex> {
    static R: OnceLock<Vec<Regex>> = OnceLock::new();
    R.get_or_init(|| {
        [
            format!(r"向{JS_WS}*(.{{1,20}}?){JS_WS}*(?:付款|转账|支付)"),
            format!(r"在{JS_WS}*(.{{1,20}}?){JS_WS}*(?:消费|支付|付款)"),
            format!(
                r"(?:收到|来自){JS_WS}*(.{{1,20}}?){JS_WS}*(?:的)?{JS_WS}*(?:付款|转账|红包|汇款)"
            ),
            format!(r"(.{{1,20}}?){JS_WS}*向(?:你|您)(?:付款|转账)"),
            format!(r"(?:商户|收款方|付款方)[:：]{JS_WS}*(.{{1,20}}?)(?:{JS_WS}|$)"),
        ]
        .iter()
        .map(|p| Regex::new(p).expect("pattern compiles"))
        .collect()
    })
}

/// Boilerplate that turns up where a merchant name would be.
fn not_a_merchant() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, "^(你|您|对方|好友|本人|账户|余额|该|此)?$")
}

fn all_digits() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, "^[0-9]+$")
}

pub fn parse_merchant(text: &str) -> Option<String> {
    for re in merchant_res() {
        let name = re
            .captures(text)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().trim().to_string());
        if let Some(name) = name {
            if !name.is_empty()
                && !not_a_merchant().is_match(&name)
                && !all_digits().is_match(&name)
            {
                return Some(name);
            }
        }
    }
    None
}

/* ---------------------------------------------------------- 6. pipeline ---- */

/// Parse one capture. `None` when it is not a payment at all — wrong package,
/// marketing copy, a chat message, or no amount to be found.
///
/// A candidate is `confident` when a merchant name came out, because that is
/// what makes the note meaningful enough to post without asking. Amount and
/// direction are required either way; the category is a guess and stays
/// editable.
pub fn parse_notification(n: &RawNotif) -> Option<NotifCandidate> {
    let source = classify_source(n)?;
    let text = full_text(n);
    if text.is_empty() || noise().is_match(&text) {
        return None;
    }
    if source == NotifSource::Wechat && !wechat_payment().is_match(&text) {
        return None;
    }

    let io = parse_io(&text)?;
    let amt = parse_amount(&text)?;
    let merchant = parse_merchant(&text);

    Some(NotifCandidate {
        io,
        amt,
        confident: merchant.is_some(),
        merchant,
        source,
        posted_at: n.posted_at,
    })
}

/// Resolve a candidate against the user's categories into an entry-shaped draft.
pub fn to_entry_draft(c: &NotifCandidate, custom: &[Category]) -> NotifEntryDraft {
    let note = c
        .merchant
        .clone()
        .unwrap_or_else(|| c.source.label().to_string());
    NotifEntryDraft {
        io: c.io,
        amt: c.amt,
        cat: map_category(c.io, None, Some(&note), custom),
        note,
        ts: c.posted_at,
        confident: c.confident,
    }
}

/* ----------------------------------------------- 7. duplicate suppression -- */

/// Two captures of one payment — 支付宝 posts a 付款成功 push and then a 账单
/// push — land seconds apart with the same amount and direction.
pub const DUP_WINDOW_MS: i64 = 3 * 60 * 1000;

/// The minimum needed to tell two payments apart. Deliberately narrower than
/// [`NotifCandidate`] so an already-recorded ledger entry can be compared
/// against a fresh capture without inventing a source for it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PaymentKey {
    pub io: Io,
    pub amt: f64,
    pub posted_at: i64,
}

impl From<&NotifCandidate> for PaymentKey {
    fn from(c: &NotifCandidate) -> Self {
        PaymentKey {
            io: c.io,
            amt: c.amt,
            posted_at: c.posted_at,
        }
    }
}

/// True when `c` restates a payment already in `seen`.
///
/// Same direction and amount inside a three-minute window counts as the same
/// payment regardless of merchant, because the two pushes for one payment often
/// word it differently — and two genuinely distinct payments of the identical
/// amount within three minutes are rare enough that a missed entry beats a
/// duplicated one.
pub fn is_duplicate(c: &PaymentKey, seen: &[PaymentKey]) -> bool {
    seen.iter().any(|s| {
        s.io == c.io && s.amt == c.amt && (s.posted_at - c.posted_at).abs() <= DUP_WINDOW_MS
    })
}

/// Parse a batch, dropping noise and collapsing repeat pushes. Order is kept
/// and the first capture of a payment wins — it is the one carrying the
/// merchant more often than the follow-up.
pub fn parse_batch(raws: &[RawNotif]) -> Vec<NotifCandidate> {
    let mut out: Vec<NotifCandidate> = Vec::new();
    for r in raws {
        if let Some(c) = parse_notification(r) {
            let keys: Vec<PaymentKey> = out.iter().map(PaymentKey::from).collect();
            if !is_duplicate(&PaymentKey::from(&c), &keys) {
                out.push(c);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn alipay(text: &str) -> RawNotif {
        RawNotif {
            id: "n0".into(),
            pkg: "com.eg.android.AlipayGphone".into(),
            text: Some(text.into()),
            posted_at: 1_000,
            ..Default::default()
        }
    }

    #[test]
    fn wallets_are_recognised_by_package() {
        assert_eq!(classify_source(&alipay("x")), Some(NotifSource::Alipay));
        let mut n = alipay("x");
        n.pkg = "com.tencent.mm".into();
        assert_eq!(classify_source(&n), Some(NotifSource::Wechat));
        n.pkg = "com.unionpay".into();
        assert_eq!(classify_source(&n), Some(NotifSource::Unionpay));
    }

    #[test]
    fn an_unknown_package_needs_the_bank_shape() {
        let mut n = alipay("随便什么");
        n.pkg = "com.example.chat".into();
        assert_eq!(classify_source(&n), None);

        n.text = Some("尾号1234 消费".into());
        assert_eq!(classify_source(&n), Some(NotifSource::Bank));
        n.text = Some("信用卡消费".into());
        assert_eq!(classify_source(&n), Some(NotifSource::Bank));
    }

    #[test]
    fn full_text_collapses_a_repeated_part() {
        let n = RawNotif {
            title: Some("支付宝".into()),
            text: Some("付款成功".into()),
            big_text: Some("付款成功".into()),
            ..Default::default()
        };
        assert_eq!(full_text(&n), "支付宝 付款成功");
    }

    #[test]
    fn full_text_drops_blanks() {
        let n = RawNotif {
            title: Some("  ".into()),
            text: Some("付款".into()),
            big_text: None,
            ..Default::default()
        };
        assert_eq!(full_text(&n), "付款");
    }

    #[test]
    fn an_amount_needs_a_currency_marker() {
        assert_eq!(parse_amount("付款 ¥35.50"), Some(35.5));
        assert_eq!(parse_amount("付款 ￥1,234.00"), Some(1234.0));
        assert_eq!(parse_amount("消费 35元"), Some(35.0));
        assert_eq!(parse_amount("消费 35 块"), Some(35.0));
        assert_eq!(parse_amount("RMB 12"), Some(12.0));
    }

    #[test]
    fn bare_digits_are_not_amounts() {
        assert_eq!(parse_amount("尾号1234的卡"), None);
        assert_eq!(parse_amount("7月21日"), None);
        assert_eq!(parse_amount("没有钱"), None);
    }

    #[test]
    fn a_zero_amount_is_skipped_and_the_next_one_taken() {
        assert_eq!(parse_amount("优惠¥0.00 实付¥35.00"), Some(35.0));
    }

    #[test]
    fn full_width_digits_are_not_amounts_because_javascript_says_so() {
        // `\d` in JS without the u flag is [0-9]; a Unicode-aware engine would
        // read this as ¥35 and post a payment the app never posts
        assert_eq!(parse_amount("付款 ¥３５"), None);
    }

    #[test]
    fn income_vocabulary_wins_over_expense() {
        assert_eq!(parse_io("退款¥32.00已原路返回"), Some(Io::Inc));
        assert_eq!(parse_io("收款到账"), Some(Io::Inc));
        assert_eq!(parse_io("消费支出"), Some(Io::Exp));
        assert_eq!(parse_io("没有动词"), None);
    }

    #[test]
    fn a_brand_name_is_not_a_verb() {
        // 支付宝 contains 支付; without stripping the brand every push from the
        // app would read as an expense
        assert_eq!(parse_io("支付宝"), None);
        assert_eq!(parse_io("微信支付"), None);
        assert_eq!(parse_io("支付宝 消费"), Some(Io::Exp));
    }

    #[test]
    fn merchant_patterns_run_most_specific_first() {
        assert_eq!(parse_merchant("向 星巴克 付款").as_deref(), Some("星巴克"));
        assert_eq!(parse_merchant("在麦当劳消费").as_deref(), Some("麦当劳"));
        assert_eq!(parse_merchant("收到张三的转账").as_deref(), Some("张三"));
        assert_eq!(parse_merchant("李四向你付款").as_deref(), Some("李四"));
        assert_eq!(
            parse_merchant("商户：全家便利店 ").as_deref(),
            Some("全家便利店")
        );
    }

    #[test]
    fn boilerplate_is_not_a_merchant() {
        assert_eq!(parse_merchant("向 对方 付款"), None);
        assert_eq!(parse_merchant("收到 好友 的转账"), None);
    }

    #[test]
    fn a_number_is_not_a_merchant() {
        assert_eq!(parse_merchant("向 12345 付款"), None);
    }

    #[test]
    fn a_confident_capture_has_a_merchant() {
        let c = parse_notification(&alipay("向 星巴克 付款 ¥35.00")).unwrap();
        assert_eq!(c.io, Io::Exp);
        assert_eq!(c.amt, 35.0);
        assert_eq!(c.merchant.as_deref(), Some("星巴克"));
        assert!(c.confident);
        assert_eq!(c.source, NotifSource::Alipay);
    }

    #[test]
    fn a_capture_without_a_merchant_is_not_confident() {
        let c = parse_notification(&alipay("消费 ¥35.00")).unwrap();
        assert!(!c.confident);
        assert!(c.merchant.is_none());
    }

    #[test]
    fn marketing_copy_is_not_a_payment() {
        assert!(parse_notification(&alipay("优惠券到账 ¥10")).is_none());
        assert!(parse_notification(&alipay("账单已出 ¥1,200 待还款")).is_none());
    }

    #[test]
    fn a_wechat_chat_message_is_not_a_payment() {
        let mut n = alipay("老王: 350元那个我转你");
        n.pkg = "com.tencent.mm".into();
        assert!(parse_notification(&n).is_none());

        n.text = Some("微信支付 向 老王 付款 ¥350".into());
        assert!(parse_notification(&n).is_some());
    }

    #[test]
    fn a_draft_falls_back_to_the_source_label_for_its_note() {
        let c = parse_notification(&alipay("消费 ¥35.00")).unwrap();
        let d = to_entry_draft(&c, &[]);
        assert_eq!(d.note, "支付宝");
        assert_eq!(d.cat, "other");
        assert_eq!(d.ts, 1_000);
    }

    #[test]
    fn a_draft_categorises_from_the_merchant_name() {
        let c = parse_notification(&alipay("向 星巴克咖啡 付款 ¥35.00")).unwrap();
        assert_eq!(to_entry_draft(&c, &[]).cat, "food");
    }

    #[test]
    fn the_same_payment_twice_inside_the_window_is_one() {
        let a = PaymentKey {
            io: Io::Exp,
            amt: 35.0,
            posted_at: 1_000_000,
        };
        let b = PaymentKey {
            io: Io::Exp,
            amt: 35.0,
            posted_at: 1_000_000 + 60_000,
        };
        assert!(is_duplicate(&b, &[a]));
    }

    #[test]
    fn outside_the_window_it_is_two_payments() {
        let a = PaymentKey {
            io: Io::Exp,
            amt: 35.0,
            posted_at: 1_000_000,
        };
        let b = PaymentKey {
            io: Io::Exp,
            amt: 35.0,
            posted_at: 1_000_000 + DUP_WINDOW_MS + 1,
        };
        assert!(!is_duplicate(&b, &[a]));
    }

    #[test]
    fn exactly_on_the_window_edge_still_counts_as_the_same() {
        let a = PaymentKey {
            io: Io::Exp,
            amt: 35.0,
            posted_at: 0,
        };
        let b = PaymentKey {
            io: Io::Exp,
            amt: 35.0,
            posted_at: DUP_WINDOW_MS,
        };
        assert!(is_duplicate(&b, &[a]));
    }

    #[test]
    fn direction_and_amount_both_have_to_match() {
        let a = PaymentKey {
            io: Io::Exp,
            amt: 35.0,
            posted_at: 0,
        };
        assert!(!is_duplicate(&PaymentKey { io: Io::Inc, ..a }, &[a]));
        assert!(!is_duplicate(&PaymentKey { amt: 36.0, ..a }, &[a]));
    }

    #[test]
    fn a_batch_keeps_the_first_capture_of_each_payment() {
        let mut second = alipay("消费 ¥35.00");
        second.posted_at = 1_000 + 60_000;
        let batch = parse_batch(&[alipay("向 星巴克 付款 ¥35.00"), second]);
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].merchant.as_deref(), Some("星巴克")); // the richer one
    }
}
