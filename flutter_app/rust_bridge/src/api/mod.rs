//! What the Flutter side may call.
//!
//! Each module here mirrors one module of `dahonghua_core`, converting between
//! the core's own shapes and the shapes that can cross an FFI boundary. The
//! core never gains an FFI attribute — it goes on answering to the parity
//! corpus, which is what makes it trustworthy in the first place.

pub mod accounts;
pub mod acct;
pub mod backup;
pub mod batch;
pub mod budget;
pub mod calc;
pub mod calendar;
pub mod capture;
pub mod catalog;
pub mod currency;
pub mod db;
pub mod export;
pub mod glass;
pub mod history;
pub mod home;
pub mod imports;
pub mod init;
pub mod liquid;
pub mod lock;
pub mod money;
pub mod networth;
pub mod period;
pub mod privacy;
pub mod rates;
pub mod record;
pub mod reimburse;
pub mod remind;
pub mod report;
pub mod search;
pub mod statement;
pub mod stats;
pub mod store;
pub mod subscriptions;
pub mod sync;
pub mod theme;
