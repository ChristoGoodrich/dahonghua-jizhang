//! `Entry` ⇄ the Supabase row, and the JSON on either side of it.
//!
//! Ported from `src/sync/rows.ts`, which says of itself that it is "kept
//! separate from the network engine so the round-trip can be unit-tested
//! without Supabase" — the same split this migration applies everywhere, made
//! by the original author before the port started.
//!
//! Three shapes, not two. The row is snake_case with an explicit `null` in
//! every column an entry did not fill; the entry omits those fields entirely.
//! That asymmetry *is* the mapping, and it is why the two directions are not
//! mirror images:
//!
//! ```text
//!   Entry { note: None }        →  row  "note": null      (written)
//!   row  "note": null           →  Entry { note: None }   (not written)
//! ```
//!
//! The round trip is not the identity, on purpose: an entry with no
//! `updated_at` comes back carrying one, because the column cannot be null and
//! `updatedAt ?? ts` is what fills it. Everything else survives, zeros and
//! empty strings and empty collections included — the TypeScript uses `??` and
//! `!= null` rather than truthiness throughout, so a `0` fee stays a `0` fee.
//!
//! What does **not** survive is a fractional timestamp. [`crate::entry::Entry`]
//! models `ts` as an `i64` where JavaScript has an `f64`, which is deliberate
//! and documented elsewhere in the migration as a bug this type rules out; the
//! cost is that a hand-edited backup saying `"ts": 1.5` is representable there
//! and not here. Nothing the app writes produces one.

use crate::entry::{Entry, EntrySource, Io, Reimburse};
use crate::jsval::Value;
use std::collections::BTreeMap;

/// One row of the `entries` table.
///
/// Every optional column is `Option`, and every `None` is written as a JSON
/// `null` rather than omitted — Postgres has no notion of an absent column, and
/// an upsert that left one out would keep whatever was there before.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct DbEntry {
    pub id: String,
    pub user_id: String,
    pub ts: i64,
    pub io: Option<Io>,
    pub cat: String,
    pub subcat: Option<String>,
    pub amt: f64,
    pub cur: Option<String>,
    pub orig_amt: Option<f64>,
    pub rate: Option<f64>,
    pub note: Option<String>,
    pub acct: Option<String>,
    pub acct_to: Option<String>,
    pub fee: Option<f64>,
    pub discount: Option<f64>,
    pub tags: Option<Vec<String>>,
    pub ledger: Option<String>,
    pub rb: Option<String>,
    pub rb_amt: Option<f64>,
    pub refund: Option<f64>,
    pub refund_of: Option<String>,
    pub from_sub: Option<bool>,
    /// `'bill' | 'notif' | null`, kept as the raw string: the column is not an
    /// enum, and a value neither half recognises must still round-trip rather
    /// than be silently dropped on the way through.
    pub src: Option<String>,
    pub deleted_at: Option<i64>,
    /// Client epoch-ms. Not nullable — see the module note on the round trip.
    pub updated_at: i64,
    pub field_ts: Option<BTreeMap<String, i64>>,
}

/// `entryToRow` — an entry, addressed to a user.
pub fn entry_to_row(e: &Entry, user_id: &str) -> DbEntry {
    DbEntry {
        id: e.id.clone(),
        user_id: user_id.to_string(),
        ts: e.ts,
        io: e.io,
        cat: e.cat.clone(),
        subcat: e.subcat.clone(),
        amt: e.amt,
        cur: e.cur.clone(),
        orig_amt: e.orig_amt,
        rate: e.rate,
        note: e.note.clone(),
        acct: e.acct.clone(),
        acct_to: e.acct_to.clone(),
        fee: e.fee,
        discount: e.discount,
        tags: e.tags.clone(),
        ledger: e.ledger.clone(),
        rb: e.rb.map(|r| r.as_str().to_string()),
        rb_amt: e.rb_amt,
        refund: e.refund,
        refund_of: e.refund_of.clone(),
        from_sub: e.from_sub,
        src: e.src.map(|s| s.as_str().to_string()),
        deleted_at: e.deleted_at,
        // the one field the round trip invents: `e.updatedAt ?? e.ts`
        updated_at: e.updated_at.unwrap_or(e.ts),
        // `e.fieldTs ?? null` — an empty map is a map, and reaches the column
        // as `{}` rather than as `null`
        field_ts: e.field_ts.clone(),
    }
}

/// `rowToEntry` — a row from the server, as a ledger entry.
///
/// A `null` column becomes an absent field, never a present null. The one
/// exception in the TypeScript is `deletedAt`, whose type admits `null`; it is
/// still dropped here, and `merge.ts` notes that "rowToEntry never emits one"
/// while still handling a legacy local row that does.
pub fn row_to_entry(r: &DbEntry) -> Entry {
    Entry {
        id: r.id.clone(),
        ts: r.ts,
        io: r.io,
        cat: r.cat.clone(),
        amt: r.amt,
        updated_at: Some(r.updated_at),
        subcat: r.subcat.clone(),
        cur: r.cur.clone(),
        orig_amt: r.orig_amt,
        rate: r.rate,
        note: r.note.clone(),
        acct: r.acct.clone(),
        acct_to: r.acct_to.clone(),
        fee: r.fee,
        discount: r.discount,
        tags: r.tags.clone(),
        ledger: r.ledger.clone(),
        // an unrecognised value becomes absent rather than kept. The TypeScript
        // casts (`r.rb as Entry['rb']`) and keeps whatever the column held, but
        // nothing downstream can read it: every consumer tests for `'pending'`
        // or `'done'`, so a third value is already indistinguishable from none.
        rb: r.rb.as_deref().and_then(Reimburse::parse),
        rb_amt: r.rb_amt,
        refund: r.refund,
        refund_of: r.refund_of.clone(),
        from_sub: r.from_sub,
        src: r.src.as_deref().and_then(EntrySource::parse),
        deleted_at: r.deleted_at,
        field_ts: r.field_ts.clone(),
    }
}

// ---------- the JSON on either side ----------

fn str_of(v: Option<&Value>) -> Option<String> {
    match v {
        Some(Value::Str(s)) => Some(s.clone()),
        _ => None,
    }
}

fn num_of(v: Option<&Value>) -> Option<f64> {
    match v {
        Some(Value::Num(n)) => Some(*n),
        _ => None,
    }
}

/// An epoch stamp, truncated toward zero the way `as i64` does.
fn ms_of(v: Option<&Value>) -> Option<i64> {
    num_of(v).filter(|n| n.is_finite()).map(|n| n as i64)
}

fn stamps_of(v: Option<&Value>) -> Option<BTreeMap<String, i64>> {
    match v {
        Some(Value::Obj(entries)) => Some(
            entries
                .iter()
                .filter_map(|(k, val)| match val {
                    Value::Num(n) if n.is_finite() => Some((k.clone(), *n as i64)),
                    _ => None,
                })
                .collect(),
        ),
        _ => None,
    }
}

fn tags_of(v: Option<&Value>) -> Option<Vec<String>> {
    match v {
        Some(Value::Arr(items)) => Some(
            items
                .iter()
                .map(|i| match i {
                    Value::Str(s) => s.clone(),
                    other => crate::jsval::stringify(other).unwrap_or_default(),
                })
                .collect(),
        ),
        _ => None,
    }
}

fn opt_str(v: &Option<String>) -> Value {
    match v {
        Some(s) => Value::Str(s.clone()),
        None => Value::Null,
    }
}

fn opt_num<T: Copy + Into<f64>>(v: &Option<T>) -> Value {
    match v {
        Some(n) => Value::Num((*n).into()),
        None => Value::Null,
    }
}

fn stamps_value(v: &BTreeMap<String, i64>) -> Value {
    Value::Obj(
        v.iter()
            .map(|(k, n)| (k.clone(), Value::Num(*n as f64)))
            .collect(),
    )
}

impl DbEntry {
    /// The JSON that crosses the wire — every column present, `null` where the
    /// entry had nothing.
    pub fn to_value(&self) -> Value {
        Value::Obj(vec![
            ("id".into(), Value::Str(self.id.clone())),
            ("user_id".into(), Value::Str(self.user_id.clone())),
            ("ts".into(), Value::Num(self.ts as f64)),
            (
                "io".into(),
                match self.io {
                    Some(io) => Value::Str(io.as_str().to_string()),
                    None => Value::Null,
                },
            ),
            ("cat".into(), Value::Str(self.cat.clone())),
            ("subcat".into(), opt_str(&self.subcat)),
            ("amt".into(), Value::Num(self.amt)),
            ("cur".into(), opt_str(&self.cur)),
            ("orig_amt".into(), opt_num(&self.orig_amt)),
            ("rate".into(), opt_num(&self.rate)),
            ("note".into(), opt_str(&self.note)),
            ("acct".into(), opt_str(&self.acct)),
            ("acct_to".into(), opt_str(&self.acct_to)),
            ("fee".into(), opt_num(&self.fee)),
            ("discount".into(), opt_num(&self.discount)),
            (
                "tags".into(),
                match &self.tags {
                    Some(t) => Value::Arr(t.iter().map(|s| Value::Str(s.clone())).collect()),
                    None => Value::Null,
                },
            ),
            ("ledger".into(), opt_str(&self.ledger)),
            ("rb".into(), opt_str(&self.rb)),
            ("rb_amt".into(), opt_num(&self.rb_amt)),
            ("refund".into(), opt_num(&self.refund)),
            ("refund_of".into(), opt_str(&self.refund_of)),
            (
                "from_sub".into(),
                match self.from_sub {
                    Some(b) => Value::Bool(b),
                    None => Value::Null,
                },
            ),
            ("src".into(), opt_str(&self.src)),
            (
                "deleted_at".into(),
                match self.deleted_at {
                    Some(n) => Value::Num(n as f64),
                    None => Value::Null,
                },
            ),
            ("updated_at".into(), Value::Num(self.updated_at as f64)),
            (
                "field_ts".into(),
                match &self.field_ts {
                    Some(f) => stamps_value(f),
                    None => Value::Null,
                },
            ),
        ])
    }

    /// A row as the server sent it.
    pub fn from_value(v: &Value) -> DbEntry {
        DbEntry {
            id: str_of(v.get("id")).unwrap_or_default(),
            user_id: str_of(v.get("user_id")).unwrap_or_default(),
            ts: ms_of(v.get("ts")).unwrap_or(0),
            io: str_of(v.get("io")).as_deref().and_then(Io::parse),
            cat: str_of(v.get("cat")).unwrap_or_default(),
            subcat: str_of(v.get("subcat")),
            amt: num_of(v.get("amt")).unwrap_or(0.0),
            cur: str_of(v.get("cur")),
            orig_amt: num_of(v.get("orig_amt")),
            rate: num_of(v.get("rate")),
            note: str_of(v.get("note")),
            acct: str_of(v.get("acct")),
            acct_to: str_of(v.get("acct_to")),
            fee: num_of(v.get("fee")),
            discount: num_of(v.get("discount")),
            tags: tags_of(v.get("tags")),
            ledger: str_of(v.get("ledger")),
            rb: str_of(v.get("rb")),
            rb_amt: num_of(v.get("rb_amt")),
            refund: num_of(v.get("refund")),
            refund_of: str_of(v.get("refund_of")),
            from_sub: match v.get("from_sub") {
                Some(Value::Bool(b)) => Some(*b),
                _ => None,
            },
            src: str_of(v.get("src")),
            deleted_at: ms_of(v.get("deleted_at")),
            updated_at: ms_of(v.get("updated_at")).unwrap_or(0),
            field_ts: stamps_of(v.get("field_ts")),
        }
    }
}

/// An entry as the store holds it: absent fields omitted, not nulled.
pub fn entry_to_value(e: &Entry) -> Value {
    let mut out: Vec<(String, Value)> = vec![
        ("id".into(), Value::Str(e.id.clone())),
        ("ts".into(), Value::Num(e.ts as f64)),
    ];
    if let Some(io) = e.io {
        out.push(("io".into(), Value::Str(io.as_str().to_string())));
    }
    out.push(("cat".into(), Value::Str(e.cat.clone())));
    out.push(("amt".into(), Value::Num(e.amt)));
    if let Some(v) = e.updated_at {
        out.push(("updatedAt".into(), Value::Num(v as f64)));
    }
    let mut push_str = |k: &str, v: &Option<String>| {
        if let Some(s) = v {
            out.push((k.to_string(), Value::Str(s.clone())));
        }
    };
    push_str("subcat", &e.subcat);
    push_str("cur", &e.cur);
    push_str("note", &e.note);
    push_str("acct", &e.acct);
    push_str("acctTo", &e.acct_to);
    push_str("ledger", &e.ledger);
    push_str("refundOf", &e.refund_of);
    let mut push_num = |k: &str, v: Option<f64>| {
        if let Some(n) = v {
            out.push((k.to_string(), Value::Num(n)));
        }
    };
    push_num("origAmt", e.orig_amt);
    push_num("rate", e.rate);
    push_num("fee", e.fee);
    push_num("discount", e.discount);
    push_num("rbAmt", e.rb_amt);
    push_num("refund", e.refund);
    if let Some(t) = &e.tags {
        out.push((
            "tags".into(),
            Value::Arr(t.iter().map(|s| Value::Str(s.clone())).collect()),
        ));
    }
    if let Some(r) = e.rb {
        out.push(("rb".into(), Value::Str(r.as_str().to_string())));
    }
    if let Some(b) = e.from_sub {
        out.push(("fromSub".into(), Value::Bool(b)));
    }
    if let Some(s) = e.src {
        out.push(("src".into(), Value::Str(s.as_str().to_string())));
    }
    if let Some(n) = e.deleted_at {
        out.push(("deletedAt".into(), Value::Num(n as f64)));
    }
    if let Some(f) = &e.field_ts {
        out.push(("fieldTs".into(), stamps_value(f)));
    }
    Value::Obj(out)
}

/// An entry read back out of JSON.
pub fn entry_from_value(v: &Value) -> Entry {
    Entry {
        id: str_of(v.get("id")).unwrap_or_default(),
        ts: ms_of(v.get("ts")).unwrap_or(0),
        io: str_of(v.get("io")).as_deref().and_then(Io::parse),
        cat: str_of(v.get("cat")).unwrap_or_default(),
        amt: num_of(v.get("amt")).unwrap_or(0.0),
        note: str_of(v.get("note")),
        acct: str_of(v.get("acct")),
        acct_to: str_of(v.get("acctTo")),
        fee: num_of(v.get("fee")),
        discount: num_of(v.get("discount")),
        subcat: str_of(v.get("subcat")),
        cur: str_of(v.get("cur")),
        orig_amt: num_of(v.get("origAmt")),
        rate: num_of(v.get("rate")),
        tags: tags_of(v.get("tags")),
        ledger: str_of(v.get("ledger")),
        rb: str_of(v.get("rb")).as_deref().and_then(Reimburse::parse),
        rb_amt: num_of(v.get("rbAmt")),
        refund: num_of(v.get("refund")),
        refund_of: str_of(v.get("refundOf")),
        from_sub: match v.get("fromSub") {
            Some(Value::Bool(b)) => Some(*b),
            _ => None,
        },
        src: str_of(v.get("src")).as_deref().and_then(EntrySource::parse),
        deleted_at: ms_of(v.get("deletedAt")),
        updated_at: ms_of(v.get("updatedAt")),
        field_ts: stamps_of(v.get("fieldTs")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jsval::stable;

    fn entry() -> Entry {
        Entry {
            id: "e1".into(),
            ts: 1000,
            io: Some(Io::Exp),
            cat: "food".into(),
            amt: 12.5,
            ..Default::default()
        }
    }

    #[test]
    fn a_full_entry_survives_the_round_trip() {
        let mut e = entry();
        e.note = Some("lunch".into());
        e.acct = Some("card".into());
        e.acct_to = Some("cash".into());
        e.fee = Some(1.0);
        e.discount = Some(2.0);
        e.subcat = Some("noodles".into());
        e.cur = Some("USD".into());
        e.orig_amt = Some(2.0);
        e.rate = Some(7.0);
        e.tags = Some(vec!["work".into()]);
        e.ledger = Some("home".into());
        e.rb = Some(Reimburse::Pending);
        e.rb_amt = Some(3.0);
        e.refund = Some(4.0);
        e.refund_of = Some("e0".into());
        e.from_sub = Some(true);
        e.src = Some(EntrySource::Bill);
        e.deleted_at = Some(5000);
        e.updated_at = Some(9000);
        e.field_ts = Some(BTreeMap::from([("amt".to_string(), 8000)]));

        assert_eq!(row_to_entry(&entry_to_row(&e, "u1")), e);
    }

    #[test]
    fn a_zero_is_not_an_absence() {
        // the TypeScript uses `??` and `!= null`, never truthiness, so every
        // one of these survives where a `||` would have erased it
        let mut e = entry();
        e.amt = 0.0;
        e.fee = Some(0.0);
        e.discount = Some(0.0);
        e.rate = Some(0.0);
        e.rb_amt = Some(0.0);
        e.refund = Some(0.0);
        e.orig_amt = Some(0.0);
        e.from_sub = Some(false);
        e.note = Some(String::new());
        e.tags = Some(vec![]);
        e.updated_at = Some(0);

        let back = row_to_entry(&entry_to_row(&e, "u1"));
        assert_eq!(back, e);
    }

    #[test]
    fn a_missing_updated_at_comes_back_filled_from_ts() {
        let e = entry();
        assert_eq!(e.updated_at, None);
        let back = row_to_entry(&entry_to_row(&e, "u1"));
        assert_eq!(back.updated_at, Some(1000)); // e.ts
    }

    #[test]
    fn no_stamp_map_and_an_empty_one_are_different_columns() {
        // `null` and `{}` are different jsonb values, and `e.fieldTs ?? null`
        // writes whichever the entry had
        let mut e = entry();
        assert_eq!(entry_to_row(&e, "u1").field_ts, None);
        e.field_ts = Some(BTreeMap::new());
        assert_eq!(entry_to_row(&e, "u1").field_ts, Some(BTreeMap::new()));
        // …and both survive the trip back
        assert_eq!(
            row_to_entry(&entry_to_row(&e, "u1")).field_ts,
            Some(BTreeMap::new())
        );
    }

    #[test]
    fn the_user_id_rides_on_the_row_and_not_the_entry() {
        let row = entry_to_row(&entry(), "u1");
        assert_eq!(row.user_id, "u1");
        // and it has nowhere to go on the way back
        assert_eq!(row_to_entry(&row).id, "e1");
    }

    #[test]
    fn every_column_is_present_in_the_wire_json_even_when_empty() {
        let v = entry_to_row(&entry(), "u1").to_value();
        // an upsert that omitted a column would keep whatever was there before
        assert_eq!(v.get("note"), Some(&Value::Null));
        assert_eq!(v.get("tags"), Some(&Value::Null));
        assert_eq!(v.get("deleted_at"), Some(&Value::Null));
        assert_eq!(v.keys().len(), 26);
    }

    #[test]
    fn an_entry_omits_what_a_row_nulls() {
        let v = entry_to_value(&entry());
        assert_eq!(v.get("note"), None);
        assert_eq!(v.get("deletedAt"), None);
        assert_eq!(
            stable(&v),
            "{\"amt\":12.5,\"cat\":\"food\",\"id\":\"e1\",\"io\":\"exp\",\"ts\":1000}"
        );
    }

    #[test]
    fn a_row_reads_back_out_of_its_own_json() {
        let mut e = entry();
        e.tags = Some(vec!["a".into(), "b".into()]);
        e.field_ts = Some(BTreeMap::from([("amt".to_string(), 7)]));
        e.from_sub = Some(false);
        e.src = Some(EntrySource::Notif);
        let row = entry_to_row(&e, "u1");
        assert_eq!(DbEntry::from_value(&row.to_value()), row);
    }

    #[test]
    fn an_entry_reads_back_out_of_its_own_json() {
        let mut e = entry();
        e.note = Some("a\"b".into());
        e.updated_at = Some(3);
        e.field_ts = Some(BTreeMap::from([("note".to_string(), 3)]));
        assert_eq!(entry_from_value(&entry_to_value(&e)), e);
    }

    #[test]
    fn an_unrecognised_enum_column_reads_as_absent() {
        let mut row = entry_to_row(&entry(), "u1");
        row.rb = Some("garbage".into());
        row.src = Some("garbage".into());
        let e = row_to_entry(&row);
        // every consumer tests for a known value, so a third one was already
        // indistinguishable from none
        assert_eq!(e.rb, None);
        assert_eq!(e.src, None);
    }
}
