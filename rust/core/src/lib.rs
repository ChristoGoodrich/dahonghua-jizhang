//! Pure ledger logic for 大红花记账 — the layer being moved off TypeScript first.
//!
//! Nothing here touches I/O, a UI framework, or a platform API, which is what
//! lets the same crate compile to a JNI library for Android and to wasm for the
//! web. Each module is a port of its `src/domain/*.ts` counterpart, tests
//! included, so parity with the shipping app is checkable rather than assumed.
//!
//! Migration status is tracked in `rust/MIGRATION.md`.

pub mod accounts;
pub mod acct;
pub mod archive;
pub mod backup;
pub mod bills;
pub mod budget;
pub mod calc;
pub mod catalog;
pub mod chart;
pub mod civil;
pub mod currency;
pub mod cycle;
pub mod dedup;
pub mod encoding;
pub mod engine;
pub mod entry;
pub mod export;
pub mod filter;
pub mod gbk_table;
pub mod glass;
pub mod inbox;
pub mod insight;
pub mod jsobj;
pub mod jsstr;
pub mod jsval;
pub mod keywords;
pub mod ledger;
pub mod list;
pub mod lock;
pub mod merge;
pub mod model;
pub mod money;
pub mod networth;
pub mod notes;
pub mod notif;
pub mod num;
pub mod period;
pub mod rates;
pub mod recap;
pub mod record;
pub mod reimburse;
pub mod remind;
pub mod rows;
pub mod search;
pub mod statement;
pub mod stats;
pub mod store;
pub mod streak;
pub mod subs;
pub mod sync;
pub mod theme;
pub mod trends;
pub mod weekly;

pub use accounts::{Account, AccountKind};
pub use calc::{apply_key, eval_expr, has_operator};
pub use catalog::{Category, Subcats, TagKind, Tags};
pub use civil::{days_in_month, month_grid, Civil};
pub use currency::{set_base_currency, BaseSwitch, Denominated};
pub use cycle::{cycle_days, cycle_range, in_cycle, shift_cycle, CycleRange};
pub use entry::{Entry, EntrySource, Io, Patch, Reimburse};
pub use ledger::{stamp, Ledger, RemoveUndo};
pub use model::{Asset, AssetKind, Budgets, Loan, LoanKind, Sub, SubFreq, Template};
pub use money::{cur_name, cur_symbol, fmt, fmt_num, fmt_short, to_base, Currencies};
pub use period::{period_range, shift_period, Period};
pub use store::Store;
