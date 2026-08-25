//! Last-write-wins merge for multi-device sync, soft-delete aware.
//!
//! Ported from `src/sync/merge.ts`, which says of itself that it is
//! "intentionally free of any Supabase/network code so it can be unit-tested
//! deterministically" — so unlike the rest of `sync/`, nothing had to be split
//! off to bring it across.
//!
//! Two tiers. When **both** sides carry per-field stamps (`fieldTs`, written by
//! `updateEntry`), each field is taken from whichever side edited it last, so
//! concurrent edits to different fields of the same entry both survive.
//! Otherwise the whole row is decided by `updatedAt`, with a deterministic
//! tiebreak on the serialised row so every device converges on the same answer.
//!
//! Deletion is a field like any other: a tombstone beats a side that never
//! stamped one, but a *newer* stamped clear — which the delete-undo writes —
//! brings the row back. Under an always-wins rule an undo could never survive a
//! sync round trip.

use crate::jsstr::js_str_cmp;
use crate::jsval::{stable, stringify, Value};
use std::cmp::Ordering;

/// The four keys the merge owns rather than treats as data.
const RESERVED: [&str; 4] = ["id", "updatedAt", "deletedAt", "fieldTs"];

fn id_of(r: &Value) -> String {
    match r.get("id") {
        Some(Value::Str(s)) => s.clone(),
        _ => String::new(),
    }
}

/// `r.updatedAt ?? 0` — nullish, so a present zero stays zero.
fn updated_at(r: &Value) -> f64 {
    match r.get("updatedAt") {
        None | Some(Value::Undefined) | Some(Value::Null) => 0.0,
        Some(Value::Num(n)) => *n,
        // a non-number survives `??` and poisons the subtraction, which is what
        // the TypeScript does; the type says this cannot happen
        _ => f64::NAN,
    }
}

fn field_ts(r: &Value, key: &str) -> f64 {
    match r.get("fieldTs").and_then(|f| f.get(key)) {
        Some(Value::Num(n)) => *n,
        _ => 0.0,
    }
}

/// True when a row carries any per-field stamp at all.
///
/// `!!r.fieldTs && Object.keys(r.fieldTs).length > 0` — an empty object is not
/// enough, so a row stamped with `{}` still takes the whole-row path.
fn has_field_ts(r: &Value) -> bool {
    match r.get("fieldTs") {
        Some(v @ Value::Obj(_)) => !v.keys().is_empty(),
        _ => false,
    }
}

/// Order two versions of the same id: `Greater` when `a` should win.
///
/// Newer `updatedAt` wins; on an exact tie the lexicographically larger
/// serialisation does, so every device picks the same row rather than each
/// keeping its own.
///
/// A `NaN` difference short-circuits **without** consulting the strings, which
/// is what `if (d !== 0) return d` does — `NaN !== 0` is true. The caller tests
/// `cmp > 0`, and `NaN > 0` is false, so `Equal` reproduces it.
pub fn compare_rows(a: &Value, b: &Value) -> Ordering {
    let d = updated_at(a) - updated_at(b);
    if d.is_nan() {
        return Ordering::Equal;
    }
    if d != 0.0 {
        return if d > 0.0 {
            Ordering::Greater
        } else {
            Ordering::Less
        };
    }
    js_str_cmp(&stable(a), &stable(b))
}

/// One field's value, taken from whichever side stamped it later.
///
/// On an equal stamp a present field beats an absent one, and two present
/// values are decided by comparing their serialisations — a deterministic
/// choice rather than a meaningful one.
fn pick_field(a: &Value, b: &Value, key: &str) -> Value {
    let ta = field_ts(a, key);
    let tb = field_ts(b, key);
    let va = a.get(key).cloned().unwrap_or(Value::Undefined);
    let vb = b.get(key).cloned().unwrap_or(Value::Undefined);
    // `ta !== tb` is true for two NaNs, and `NaN > NaN` is false, so a pair of
    // unusable stamps takes `b`
    if ta != tb || (ta.is_nan() && tb.is_nan()) {
        return if ta > tb { va } else { vb };
    }
    if va == Value::Undefined {
        return vb;
    }
    if vb == Value::Undefined {
        return va;
    }
    let sa = stringify(&va).unwrap_or_default();
    let sb = stringify(&vb).unwrap_or_default();
    if js_str_cmp(&sa, &sb) != Ordering::Less {
        va
    } else {
        vb
    }
}

/// `Math.max`, which propagates `NaN` where `f64::max` swallows it.
fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.max(b)
    }
}

/// Field-level merge: every field from whichever side edited it more recently.
pub fn merge_row(a: &Value, b: &Value) -> Value {
    // the union of both key sets, in the order a JavaScript `Set` would hold
    // them: a's keys, then b's new ones
    let mut keys: Vec<String> = Vec::new();
    for k in a.keys().into_iter().chain(b.keys()) {
        if !RESERVED.contains(&k) && !keys.iter().any(|x| x == k) {
            keys.push(k.to_string());
        }
    }

    let mut out: Vec<(String, Value)> = keys
        .iter()
        .map(|k| (k.clone(), pick_field(a, b, k)))
        .collect();

    // `deletedAt` by its own stamp, so a newer stamped clear resurrects the
    // row. With no stamps the older precedence holds: a tombstone beats
    // absence, and two tombstones keep the later one. `null` counts as absent —
    // `rowToEntry` never emits one, but a legacy local row can.
    let ta = field_ts(a, "deletedAt");
    let tb = field_ts(b, "deletedAt");
    let del_of = |r: &Value| match r.get("deletedAt") {
        Some(Value::Num(n)) => Some(*n),
        _ => None,
    };
    let da = del_of(a);
    let db = del_of(b);
    let del = if ta != tb {
        if ta > tb {
            da
        } else {
            db
        }
    } else {
        match (da, db) {
            (None, _) => db,
            (_, None) => da,
            (Some(x), Some(y)) => Some(js_max(x, y)),
        }
    };
    if let Some(v) = del {
        out.push(("deletedAt".to_string(), Value::Num(v)));
    }

    // every stamp from both sides, each at its later time
    let mut ft: Vec<(String, Value)> = match a.get("fieldTs") {
        Some(Value::Obj(entries)) => entries.clone(),
        _ => vec![],
    };
    if let Some(Value::Obj(bs)) = b.get("fieldTs") {
        for (k, v) in bs {
            let bn = match v {
                Value::Num(n) => *n,
                _ => 0.0,
            };
            match ft.iter_mut().find(|(x, _)| x == k) {
                Some((_, cur)) => {
                    let an = match cur {
                        Value::Num(n) => *n,
                        _ => 0.0,
                    };
                    *cur = Value::Num(js_max(an, bn));
                }
                None => ft.push((k.clone(), Value::Num(js_max(0.0, bn)))),
            }
        }
    }
    out.push(("fieldTs".to_string(), Value::Obj(ft)));
    out.push((
        "updatedAt".to_string(),
        Value::Num(js_max(updated_at(a), updated_at(b))),
    ));
    out.push((
        "id".to_string(),
        a.get("id").cloned().unwrap_or(Value::Undefined),
    ));
    Value::Obj(out)
}

/// Resolve the two versions of one id, recording a conflict if they differ.
///
/// Shared by [`merge_by_id`] (the pull) and [`merge_one`] (a realtime message)
/// so the two paths cannot answer differently. They did: the realtime handler
/// compared `updatedAt` and took the whole newer row, which discarded exactly
/// the concurrent field edit `fieldTs` exists to preserve — and discarded the
/// stamp with it, so no later pull could tell anything had gone.
fn resolve(lv: &Value, rv: &Value, conflicts: &mut Vec<Conflict>) -> Value {
    let differ = stable(lv) != stable(rv);
    let mut report = |resolution| {
        if differ {
            conflicts.push(Conflict {
                entry_id: id_of(lv),
                local_updated_at: updated_at(lv),
                remote_updated_at: updated_at(rv),
                resolution,
            });
        }
    };
    if has_field_ts(lv) && has_field_ts(rv) {
        report(Resolution::Merged);
        return merge_row(lv, rv);
    }
    let remote_wins = compare_rows(rv, lv) == Ordering::Greater;
    report(if remote_wins {
        Resolution::Remote
    } else {
        Resolution::Local
    });
    if remote_wins {
        rv.clone()
    } else {
        lv.clone()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Resolution {
    Local,
    Remote,
    Merged,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Conflict {
    pub entry_id: String,
    pub local_updated_at: f64,
    pub remote_updated_at: f64,
    pub resolution: Resolution,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MergeResult {
    /// The authoritative set to store locally.
    pub merged: Vec<Value>,
    /// Rows the server has not seen the latest of.
    pub to_push: Vec<Value>,
    pub conflicts: Vec<Conflict>,
}

/// Merge local and remote rows by id.
///
/// Field-level when both sides carry stamps, whole-row newest-wins otherwise.
/// A row is pushed when the server lacks it, or when what the merge chose
/// differs from what the server holds.
pub fn merge_by_id(local: &[Value], remote: &[Value]) -> MergeResult {
    // the union of both id sets, local first — a JavaScript `Set` iterates by
    // insertion and the output order follows it
    let mut ids: Vec<String> = Vec::new();
    for r in local.iter().chain(remote) {
        let id = id_of(r);
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    // `new Map(rows.map(r => [r.id, r]))` on the other side, and a Map keeps the
    // LAST entry written for a key — so a set holding one id twice resolves to
    // its last copy, not its first. `.find()` took the first and answered
    // differently; the corpus had never contained a duplicate id, and an
    // importV7 restore reads whatever ids are in the user's backup file.
    let find = |rows: &[Value], id: &str| rows.iter().rev().find(|r| id_of(r) == id).cloned();

    let mut merged = Vec::new();
    let mut to_push = Vec::new();
    let mut conflicts = Vec::new();
    for id in &ids {
        let l = find(local, id);
        let r = find(remote, id);
        let win = match (&l, &r) {
            (Some(lv), Some(rv)) => resolve(lv, rv, &mut conflicts),
            (Some(lv), None) => lv.clone(),
            (None, Some(rv)) => rv.clone(),
            (None, None) => continue,
        };
        let push = match &r {
            None => true,
            Some(rv) => stable(&win) != stable(rv),
        };
        merged.push(win.clone());
        if push {
            to_push.push(win);
        }
    }
    MergeResult {
        merged,
        to_push,
        conflicts,
    }
}

/// The result of folding one incoming remote row into the local set.
#[derive(Debug, Clone, PartialEq)]
pub struct MergeOneResult {
    /// The local set with the incoming row resolved into it.
    pub rows: Vec<Value>,
    /// The resolved row, when the server's copy is not it.
    pub push: Option<Value>,
    pub conflicts: Vec<Conflict>,
}

/// Merge ONE incoming remote row into the local set — the realtime path.
///
/// Not `merge_by_id(local, &[remote])`: that treats every row the message did
/// not mention as missing from the server and would re-upload the whole ledger
/// on every echo. This resolves the one id and reports whether the result still
/// needs pushing, which it does whenever the local side contributed anything —
/// a field the message had not seen, or a whole row that simply won.
pub fn merge_one(local: &[Value], remote: &Value) -> MergeOneResult {
    let id = id_of(remote);
    let mut conflicts = Vec::new();
    let Some(idx) = local.iter().position(|x| id_of(x) == id) else {
        let mut rows = local.to_vec();
        rows.push(remote.clone());
        return MergeOneResult {
            rows,
            push: None,
            conflicts,
        };
    };
    let win = resolve(&local[idx], remote, &mut conflicts);
    let push = if stable(&win) != stable(remote) {
        Some(win.clone())
    } else {
        None
    };
    let mut rows = local.to_vec();
    rows[idx] = win;
    MergeOneResult {
        rows,
        push,
        conflicts,
    }
}

/// The rows the UI should draw — everything without a tombstone.
///
/// `!r.deletedAt` is a truthiness test, so a `deletedAt` of **zero** is a live
/// row here. Note [`merge_row`] does not agree: it treats a zero as a real
/// stamp and maxes it. Both are reproduced; the inconsistency is the
/// TypeScript's.
pub fn live_rows(rows: &[Value]) -> Vec<Value> {
    rows.iter()
        .filter(|r| match r.get("deletedAt") {
            Some(Value::Num(n)) => *n == 0.0 || n.is_nan(),
            _ => true,
        })
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obj(pairs: &[(&str, Value)]) -> Value {
        Value::Obj(
            pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.clone()))
                .collect(),
        )
    }
    fn s(v: &str) -> Value {
        Value::Str(v.to_string())
    }
    fn n(v: f64) -> Value {
        Value::Num(v)
    }
    fn row(id: &str, updated: f64, amt: f64) -> Value {
        obj(&[("id", s(id)), ("updatedAt", n(updated)), ("amt", n(amt))])
    }

    #[test]
    fn a_row_only_one_side_has_comes_through() {
        let l = row("a", 1.0, 10.0);
        let r = row("b", 1.0, 20.0);
        let out = merge_by_id(&[l], &[r]);
        assert_eq!(out.merged.len(), 2);
        // the local-only row is not on the server, so it is pushed
        assert_eq!(out.to_push.len(), 1);
        assert_eq!(id_of(&out.to_push[0]), "a");
    }

    #[test]
    fn the_newer_row_wins_without_field_stamps() {
        let l = row("a", 1.0, 10.0);
        let r = row("a", 2.0, 20.0);
        let out = merge_by_id(&[l], &[r]);
        assert_eq!(out.merged[0].num("amt"), Some(20.0));
        assert!(out.to_push.is_empty()); // the winner is what the server holds
        assert_eq!(out.conflicts[0].resolution, Resolution::Remote);
    }

    #[test]
    fn an_exact_tie_is_broken_the_same_way_on_every_device() {
        let l = row("a", 1.0, 10.0);
        let r = row("a", 1.0, 20.0);
        let from_l =
            merge_by_id(std::slice::from_ref(&l), std::slice::from_ref(&r)).merged[0].clone();
        let from_r = merge_by_id(&[r], &[l]).merged[0].clone();
        assert_eq!(stable(&from_l), stable(&from_r));
    }

    #[test]
    fn identical_rows_are_no_conflict_and_no_push() {
        let l = row("a", 1.0, 10.0);
        let out = merge_by_id(std::slice::from_ref(&l), std::slice::from_ref(&l));
        assert!(out.conflicts.is_empty());
        assert!(out.to_push.is_empty());
    }

    #[test]
    fn each_field_comes_from_whichever_side_edited_it_last() {
        let l = obj(&[
            ("id", s("a")),
            ("updatedAt", n(5.0)),
            ("amt", n(10.0)),
            ("note", s("mine")),
            ("fieldTs", obj(&[("amt", n(9.0)), ("note", n(1.0))])),
        ]);
        let r = obj(&[
            ("id", s("a")),
            ("updatedAt", n(6.0)),
            ("amt", n(20.0)),
            ("note", s("theirs")),
            ("fieldTs", obj(&[("amt", n(2.0)), ("note", n(8.0))])),
        ]);
        let out = merge_by_id(&[l], &[r]);
        let m = &out.merged[0];
        assert_eq!(m.num("amt"), Some(10.0)); // local stamped amt later
        assert_eq!(m.get("note"), Some(&s("theirs"))); // remote stamped note later
        assert_eq!(m.num("updatedAt"), Some(6.0));
        assert_eq!(out.conflicts[0].resolution, Resolution::Merged);
    }

    #[test]
    fn a_field_present_on_only_one_side_survives_an_equal_stamp() {
        let l = obj(&[
            ("id", s("a")),
            ("note", s("kept")),
            ("fieldTs", obj(&[("amt", n(1.0))])),
        ]);
        let r = obj(&[("id", s("a")), ("fieldTs", obj(&[("amt", n(1.0))]))]);
        let out = merge_by_id(&[l], &[r]);
        assert_eq!(out.merged[0].get("note"), Some(&s("kept")));
    }

    #[test]
    fn a_tombstone_beats_a_side_that_never_stamped_one() {
        // both sides need *some* stamp or this takes the whole-row path, where
        // the winner is decided by the serialisation rather than by the
        // tombstone — which is what the first draft of this test measured
        let l = obj(&[
            ("id", s("a")),
            ("updatedAt", n(1.0)),
            ("fieldTs", obj(&[("amt", n(1.0))])),
        ]);
        let r = obj(&[
            ("id", s("a")),
            ("updatedAt", n(1.0)),
            ("deletedAt", n(500.0)),
            ("fieldTs", obj(&[("amt", n(1.0))])),
        ]);
        let out = merge_by_id(&[l], &[r]);
        assert_eq!(out.merged[0].num("deletedAt"), Some(500.0));
    }

    #[test]
    fn without_any_stamp_a_tombstone_is_just_another_field() {
        // the whole-row path: equal `updatedAt`, so the serialisation decides,
        // and `{"deletedAt"…` sorts before `{"id"…` — the tombstone loses
        let l = obj(&[("id", s("a")), ("updatedAt", n(1.0))]);
        let r = obj(&[
            ("id", s("a")),
            ("updatedAt", n(1.0)),
            ("deletedAt", n(500.0)),
        ]);
        assert_eq!(merge_by_id(&[l], &[r]).merged[0].num("deletedAt"), None);
    }

    #[test]
    fn a_newer_stamped_clear_brings_the_row_back() {
        // the delete-undo: a stamped clear that is newer than the tombstone
        let l = obj(&[
            ("id", s("a")),
            ("updatedAt", n(2.0)),
            ("amt", n(1.0)),
            ("fieldTs", obj(&[("deletedAt", n(900.0))])),
        ]);
        let r = obj(&[
            ("id", s("a")),
            ("updatedAt", n(1.0)),
            ("amt", n(1.0)),
            ("deletedAt", n(500.0)),
            ("fieldTs", obj(&[("deletedAt", n(500.0))])),
        ]);
        let out = merge_by_id(&[l], &[r]);
        assert_eq!(out.merged[0].get("deletedAt"), None);
    }

    #[test]
    fn an_older_stamped_clear_still_loses() {
        let l = obj(&[("id", s("a")), ("fieldTs", obj(&[("deletedAt", n(100.0))]))]);
        let r = obj(&[
            ("id", s("a")),
            ("deletedAt", n(500.0)),
            ("fieldTs", obj(&[("deletedAt", n(900.0))])),
        ]);
        let out = merge_by_id(&[l], &[r]);
        assert_eq!(out.merged[0].num("deletedAt"), Some(500.0));
    }

    #[test]
    fn two_stamped_tombstones_keep_the_later_delete_time() {
        let l = obj(&[
            ("id", s("a")),
            ("deletedAt", n(100.0)),
            ("fieldTs", obj(&[("deletedAt", n(7.0))])),
        ]);
        let r = obj(&[
            ("id", s("a")),
            ("deletedAt", n(500.0)),
            ("fieldTs", obj(&[("deletedAt", n(7.0))])),
        ]);
        let out = merge_by_id(&[l], &[r]);
        assert_eq!(out.merged[0].num("deletedAt"), Some(500.0));
    }

    #[test]
    fn an_empty_field_ts_takes_the_whole_row_path() {
        let l = obj(&[
            ("id", s("a")),
            ("updatedAt", n(1.0)),
            ("amt", n(10.0)),
            ("fieldTs", Value::Obj(vec![])),
        ]);
        let r = obj(&[
            ("id", s("a")),
            ("updatedAt", n(2.0)),
            ("amt", n(20.0)),
            ("fieldTs", Value::Obj(vec![])),
        ]);
        let out = merge_by_id(&[l], &[r]);
        assert_eq!(out.conflicts[0].resolution, Resolution::Remote);
    }

    #[test]
    fn a_stamp_for_a_field_the_row_does_not_carry_is_still_seen() {
        // the bug the TypeScript carried: an allowlist replacer hid this
        let l = obj(&[
            ("id", s("a")),
            ("updatedAt", n(1.0)),
            ("amt", n(10.0)),
            ("fieldTs", obj(&[("amt", n(1.0)), ("note", n(9.0))])),
        ]);
        let r = obj(&[
            ("id", s("a")),
            ("updatedAt", n(1.0)),
            ("amt", n(10.0)),
            ("fieldTs", obj(&[("amt", n(1.0)), ("note", n(5.0))])),
        ]);
        let out = merge_by_id(&[l], &[r]);
        assert_eq!(out.merged[0].get("fieldTs").unwrap().num("note"), Some(9.0));
        // the server holds the older stamp, so the merge has something to send
        assert_eq!(out.to_push.len(), 1);
    }

    #[test]
    fn live_rows_reads_a_tombstone_as_truthy() {
        let rows = vec![
            obj(&[("id", s("a"))]),
            obj(&[("id", s("b")), ("deletedAt", n(0.0))]),
            obj(&[("id", s("c")), ("deletedAt", n(1.0))]),
        ];
        let live = live_rows(&rows);
        let ids: Vec<String> = live.iter().map(id_of).collect();
        // zero is falsy, so `b` is live — which `merge_row` does not agree with
        assert_eq!(ids, vec!["a", "b"]);
    }

    #[test]
    fn an_emoji_decides_a_tie_by_utf16_order() {
        // the tiebreak compares serialised rows, and JavaScript compares
        // strings by code unit — an emoji sorts below U+E000
        let l = obj(&[
            ("id", s("a")),
            ("updatedAt", n(1.0)),
            ("note", s("\u{1F600}")),
        ]);
        let r = obj(&[
            ("id", s("a")),
            ("updatedAt", n(1.0)),
            ("note", s("\u{E000}")),
        ]);
        // remote is the larger serialisation under UTF-16, so remote wins
        assert_eq!(compare_rows(&r, &l), Ordering::Greater);
    }

    // ---------- merge_one: the realtime path ----------

    fn stamped(id: &str, updated: f64, fields: &[(&str, Value)], ts: &[(&str, f64)]) -> Value {
        let mut pairs: Vec<(String, Value)> = vec![
            ("id".to_string(), s(id)),
            ("updatedAt".to_string(), n(updated)),
        ];
        for (k, v) in fields {
            pairs.push((k.to_string(), v.clone()));
        }
        pairs.push((
            "fieldTs".to_string(),
            Value::Obj(ts.iter().map(|(k, t)| (k.to_string(), n(*t))).collect()),
        ));
        Value::Obj(pairs)
    }

    #[test]
    fn one_row_keeps_a_concurrent_field_edit_the_way_the_pull_would() {
        // the note was edited here at 1000, the amount elsewhere at 2000
        let local = stamped(
            "e1",
            1000.0,
            &[("amt", n(10.0)), ("note", s("mine"))],
            &[("note", 1000.0), ("amt", 500.0)],
        );
        let remote = stamped(
            "e1",
            2000.0,
            &[("amt", n(99.0))],
            &[("amt", 2000.0), ("note", 500.0)],
        );

        let out = merge_one(std::slice::from_ref(&local), &remote);

        assert_eq!(out.rows[0].num("amt"), Some(99.0));
        assert_eq!(out.rows[0].get("note"), Some(&s("mine")));
        // and it answers what the pull answers, which is the whole point
        let pulled = merge_by_id(&[local], &[remote]);
        assert_eq!(stable(&out.rows[0]), stable(&pulled.merged[0]));
    }

    #[test]
    fn one_row_asks_for_a_push_when_the_local_side_contributed() {
        let local = stamped(
            "e1",
            1000.0,
            &[("amt", n(10.0)), ("note", s("mine"))],
            &[("note", 1000.0), ("amt", 500.0)],
        );
        let remote = stamped(
            "e1",
            2000.0,
            &[("amt", n(99.0))],
            &[("amt", 2000.0), ("note", 500.0)],
        );
        assert!(merge_one(&[local], &remote).push.is_some());
    }

    #[test]
    fn our_own_echo_asks_for_nothing() {
        let r = stamped("e1", 1000.0, &[("amt", n(10.0))], &[("amt", 1000.0)]);
        let out = merge_one(std::slice::from_ref(&r), &r);
        assert_eq!(out.push, None);
        assert_eq!(out.rows.len(), 1);
    }

    #[test]
    fn an_unseen_row_is_appended_and_not_pushed_back() {
        let out = merge_one(&[row("a", 100.0, 1.0)], &row("b", 200.0, 2.0));
        assert_eq!(out.rows.len(), 2);
        assert_eq!(id_of(&out.rows[1]), "b");
        assert_eq!(out.push, None);
    }

    #[test]
    fn a_stale_message_leaves_the_local_row_and_says_the_server_is_behind() {
        let out = merge_one(&[row("a", 9999.0, 10.0)], &row("a", 5.0, 1.0));
        assert_eq!(out.rows[0].num("amt"), Some(10.0));
        assert_eq!(out.push.as_ref().and_then(|p| p.num("amt")), Some(10.0));
    }

    #[test]
    fn one_row_reports_the_conflict_the_way_the_pull_does() {
        let out = merge_one(&[row("a", 100.0, 10.0)], &row("a", 200.0, 99.0));
        assert_eq!(
            out.conflicts,
            vec![Conflict {
                entry_id: "a".to_string(),
                local_updated_at: 100.0,
                remote_updated_at: 200.0,
                resolution: Resolution::Remote,
            }]
        );
    }

    #[test]
    fn an_identical_pair_is_not_a_conflict() {
        let out = merge_one(&[row("a", 100.0, 10.0)], &row("a", 100.0, 10.0));
        assert!(out.conflicts.is_empty());
        assert_eq!(out.push, None);
    }

    #[test]
    fn a_repeated_id_resolves_to_its_last_copy() {
        // `new Map(rows.map(...))` keeps the last entry written for a key, and
        // a restored backup is a file that can name the same id twice
        let out = merge_by_id(&[row("a", 1.0, 10.0), row("a", 2.0, 99.0)], &[]);
        assert_eq!(out.merged.len(), 1);
        assert_eq!(out.merged[0].num("amt"), Some(99.0));
    }

    #[test]
    fn a_repeated_id_on_the_remote_side_resolves_the_same_way() {
        let out = merge_by_id(&[], &[row("a", 1.0, 10.0), row("a", 2.0, 99.0)]);
        assert_eq!(out.merged.len(), 1);
        assert_eq!(out.merged[0].num("amt"), Some(99.0));
    }
}
