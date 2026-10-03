//! 智能记账 — a sentence, a picture or a question, turned into something the
//! ledger can use.
//!
//! The shipping app had `src/ai/`: one entry out of a sentence, one out of a
//! receipt, both only with a network and a key, and the port dropped all of it.
//! This is that, and more of it:
//!
//! * [`quick`] — 一句话记账. Every entry in a sentence, read **on the phone**
//!   first; a model's reading, when there is one, checked the same way.
//! * [`ask`] — 问账本. A question becomes a query, and the query runs here. A
//!   model only ever writes the query; it never sees a row.
//! * [`wire`] — the request bodies and the reading of replies, and so the
//!   statement of what leaves the phone.
//! * [`words`] — amounts and days in the words people use for them.
//!
//! The network is the platform's, and so is the key. Everything a model says
//! is untrusted input and is checked here before the ledger sees it.

pub mod ask;
pub mod quick;
pub mod wire;
pub mod words;
