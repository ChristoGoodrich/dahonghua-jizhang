//! Pure ledger logic for 大红花记账 — the layer being moved off TypeScript first.
//!
//! Nothing here touches I/O, a UI framework, or a platform API, which is what
//! lets the same crate compile to a JNI library for Android and to wasm for the
//! web. Each module is a port of its `src/domain/*.ts` counterpart, tests
//! included, so parity with the shipping app is checkable rather than assumed.
//!
//! Migration status is tracked in `rust/MIGRATION.md`.

pub mod calc;
pub mod civil;
pub mod cycle;
pub mod money;
pub mod num;

pub use calc::{apply_key, eval_expr, has_operator};
pub use civil::{days_in_month, month_grid, Civil};
pub use cycle::{cycle_days, cycle_range, in_cycle, shift_cycle, CycleRange};
pub use money::{cur_name, cur_symbol, fmt, fmt_num, fmt_short, to_base, Currencies};
