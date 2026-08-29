//! What the Flutter side may call.
//!
//! Each module here mirrors one module of `dahonghua_core`, converting between
//! the core's own shapes and the shapes that can cross an FFI boundary. The
//! core never gains an FFI attribute — it goes on answering to the parity
//! corpus, which is what makes it trustworthy in the first place.

pub mod accounts;
pub mod backup;
pub mod budget;
pub mod calc;
pub mod catalog;
pub mod currency;
pub mod glass;
pub mod init;
pub mod money;
pub mod networth;
pub mod record;
pub mod reimburse;
pub mod report;
pub mod stats;
pub mod store;
pub mod subscriptions;
