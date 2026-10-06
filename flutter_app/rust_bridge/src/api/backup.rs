//! Backups across the boundary: what a snapshot is called, what goes in it,
//! which of them to keep, and the optional lock on the way out.
//!
//! The bytes are Dart's — reading a directory and writing a file is the
//! platform's job and always has been. What crosses is the naming, the
//! ordering, the pruning, the document and (now) the envelope around it.
//!
//! Encryption lives here rather than in `core`. A cipher is not a decision the
//! ledger needs to own, and `core` keeps its one dependency. The shipping app
//! used AES-256-GCM over a PBKDF2 key; this is the same shape, with the
//! iteration count carried in the envelope so it can be raised later without
//! stranding old files.

use dahonghua_core::backup as core;
use dahonghua_core::jsval::{parse_checked, stable, Value};
use dahonghua_core::rows::entry_to_value;
use flutter_rust_bridge::frb;

use super::store::{load_config, load_entries, snapshot_config, store};

// ---------- encryption ----------

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::Sha256;

/// PBKDF2 iterations. In the envelope, so a future build can raise it.
const ITERATIONS: u32 = 600_000;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

fn b64(bytes: &[u8]) -> String {
    B64.encode(bytes)
}

fn unb64(s: &str) -> Option<Vec<u8>> {
    B64.decode(s).ok()
}

fn derive_key(password: &str, salt: &[u8], iterations: u32) -> [u8; KEY_LEN] {
    let mut key = [0u8; KEY_LEN];
    pbkdf2::pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, iterations, &mut key);
    key
}

/// What `decrypt_backup` answers.
#[derive(Debug, Clone, PartialEq)]
pub struct DecryptResult {
    /// False when the envelope would not open. Nothing is restored in that
    /// case — a half-restored ledger is worse than a refused one.
    pub ok: bool,
    /// The document, present only when `ok`.
    pub json: String,
    /// Why it failed, for the screen to show. Empty on success.
    pub error: String,
}

/// Wrap `plaintext` in a password-sealed envelope.
///
/// Returns an empty string when the password is empty — there is no such
/// thing as an unsealed sealed file, and writing one would look like success.
///
/// The envelope is a small JSON object: format version, KDF name and
/// iterations, salt, nonce and ciphertext. Salt and nonce are not secret;
/// they only have to be unique per file.
#[frb(sync)]
pub fn encrypt_backup(plaintext: String, password: String) -> String {
    if password.is_empty() {
        return String::new();
    }
    let mut salt = [0u8; SALT_LEN];
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce_bytes);

    let key_bytes = derive_key(&password, &salt, ITERATIONS);
    let key = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_bytes));
    let nonce = Nonce::from_slice(&nonce_bytes);
    let Ok(ct) = key.encrypt(nonce, plaintext.as_bytes()) else {
        return String::new();
    };

    stable(&Value::Obj(vec![
        ("app".into(), Value::Str("dahonghua".into())),
        ("enc".into(), Value::Num(1.0)),
        ("kdf".into(), Value::Str("pbkdf2-sha256".into())),
        ("iterations".into(), Value::Num(ITERATIONS as f64)),
        ("salt".into(), Value::Str(b64(&salt))),
        ("iv".into(), Value::Str(b64(&nonce_bytes))),
        ("ct".into(), Value::Str(b64(&ct))),
    ]))
}

/// Is this document a sealed envelope rather than a plain backup?
#[frb(sync)]
pub fn is_encrypted_doc(json: String) -> bool {
    matches!(
        parse_checked(&json),
        Some(v) if matches!(v.get("enc"), Some(Value::Num(_)))
            && matches!(v.get("ct"), Some(Value::Str(_)))
    )
}

/// Open a sealed envelope with `password`.
///
/// Refuses rather than returning a fragment: AES-GCM's authentication tag is
/// the whole point, and a "successful" decrypt of damaged or wrong-password
/// data is not a thing this algorithm produces.
#[frb(sync)]
pub fn decrypt_backup(envelope: String, password: String) -> DecryptResult {
    let fail = |error: &str| DecryptResult {
        ok: false,
        json: String::new(),
        error: error.to_string(),
    };
    let Some(doc) = parse_checked(&envelope) else {
        return fail("not an encrypted backup");
    };
    if !matches!(doc.get("enc"), Some(Value::Num(_))) {
        return fail("not an encrypted backup");
    }
    let Some(Value::Num(iter_f)) = doc.get("iterations") else {
        return fail("not an encrypted backup");
    };
    let iterations = if *iter_f >= 1.0 && *iter_f <= 10_000_000.0 {
        *iter_f as u32
    } else {
        return fail("not an encrypted backup");
    };
    let Some(salt) = doc.get("salt").and_then(as_str).and_then(|s| unb64(s)) else {
        return fail("not an encrypted backup");
    };
    let Some(iv) = doc.get("iv").and_then(as_str).and_then(|s| unb64(s)) else {
        return fail("not an encrypted backup");
    };
    let Some(ct) = doc.get("ct").and_then(as_str).and_then(|s| unb64(s)) else {
        return fail("not an encrypted backup");
    };
    if salt.is_empty() || iv.len() != NONCE_LEN || ct.is_empty() {
        return fail("not an encrypted backup");
    }

    let key_bytes = derive_key(&password, &salt, iterations);
    let key = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_bytes));
    let nonce = Nonce::from_slice(&iv);
    let Ok(pt) = key.decrypt(nonce, ct.as_slice()) else {
        return fail("wrong password, or the file is damaged");
    };
    let Ok(json) = String::from_utf8(pt) else {
        return fail("wrong password, or the file is damaged");
    };
    // The GCM tag said the bytes are intact. If they are not a document,
    // this file was never a backup — restoring it would replace the ledger
    // with noise.
    if parse_checked(&json).is_none() {
        return fail("this file is not a backup document");
    }
    DecryptResult {
        ok: true,
        json,
        error: String::new(),
    }
}

fn as_str(v: &Value) -> Option<&str> {
    match v {
        Value::Str(s) => Some(s.as_str()),
        _ => None,
    }
}

/// One snapshot, as read back off a directory listing.
#[derive(Debug, Clone, PartialEq)]
pub struct BackupInfoView {
    pub name: String,
    /// Epoch milliseconds. `NaN` when the name carries no usable number — which
    /// sorts last rather than pretending to be a time.
    pub time: f64,
    pub encrypted: bool,
}

/// What a backup taken now is called.
#[frb(sync)]
pub fn backup_name(ts: f64, encrypted: bool) -> String {
    core::backup_name(ts, encrypted)
}

/// A directory listing, filtered to backups and sorted newest first.
///
/// The sort matters more than it looks: pruning keeps the first `keep`, so a
/// listing that came back in the wrong order would delete the wrong files.
#[frb(sync)]
pub fn list_backups(names: Vec<String>) -> Vec<BackupInfoView> {
    core::list_backups(&names)
        .into_iter()
        .map(|b| BackupInfoView {
            name: b.name,
            time: b.time,
            encrypted: b.encrypted,
        })
        .collect()
}

/// Which files to delete so that `keep` remain. Newest-first input.
#[frb(sync)]
pub fn prune_backups(names: Vec<String>, keep: u32) -> Vec<String> {
    let list = core::list_backups(&names);
    core::prune(&list, keep as usize)
        .into_iter()
        .map(|b| b.name.clone())
        .collect()
}

/// How many snapshots are kept by default.
#[frb(sync)]
pub fn max_backups() -> u32 {
    core::MAX_BACKUPS as u32
}

/// The document a backup holds: the whole store, stamped.
///
/// `version` is the **app's** schema version and not the file format's — an
/// importer needs to know which shape the ledger is in, which is a different
/// question from which shape the wrapper is in.
///
/// Returns an empty string when the snapshot cannot be produced. Writing a
/// document that *looks* like a backup and holds an empty ledger is worse than
/// writing nothing: the user believes they are covered, and the first restore
/// is the discovery. The caller refuses the empty string.
#[frb(sync)]
pub fn build_backup(ts: f64) -> String {
    // Entries are built from the rows themselves. Re-reading their JSON only
    // to parse it back invites exactly the failure this function must not
    // paper over.
    let entries = Value::Arr(store().ledger.all().iter().map(entry_to_value).collect());
    let Some(config) = parse_checked(&snapshot_config()) else {
        return String::new();
    };
    if !matches!(config, Value::Obj(_)) {
        return String::new();
    }
    stable(&Value::Obj(vec![
        ("app".into(), Value::Str("dahonghua".into())),
        (
            "version".into(),
            Value::Num(core::BACKUP_APP_VERSION as f64),
        ),
        ("timestamp".into(), Value::Num(ts)),
        ("entries".into(), entries),
        ("config".into(), config),
    ]))
}

/// What restoring a document did.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RestoreResult {
    /// False when the document could not be read at all. Nothing is written in
    /// that case — a half-restored ledger is worse than a refused one.
    pub ok: bool,
    /// How many rows landed.
    pub entries: u32,
    /// Whether the document carried a config section to restore.
    pub config: bool,
}

/// Restore a backup document, replacing the ledger and the config.
///
/// Refuses outright rather than restoring what it can: a document that will not
/// parse says nothing about which half of it was intended, and a ledger half
/// replaced is worse than one not replaced. The same reason `load_entries`
/// answers `-1` instead of loading the rows it managed to read.
#[frb(sync)]
pub fn restore_backup(json: String) -> RestoreResult {
    let Some(doc) = parse_checked(&json) else {
        return RestoreResult {
            ok: false,
            entries: 0,
            config: false,
        };
    };
    // The wrapper is not required. A document that is just an array of entries
    // is what an older export produced, and refusing it would be refusing the
    // files this feature exists to read.
    let entries_json = match doc.get("entries") {
        Some(v @ Value::Arr(_)) => stable(v),
        _ => match &doc {
            Value::Arr(_) => stable(&doc),
            _ => {
                return RestoreResult {
                    ok: false,
                    entries: 0,
                    config: false,
                }
            }
        },
    };
    let n = load_entries(entries_json);
    if n < 0 {
        return RestoreResult {
            ok: false,
            entries: 0,
            config: false,
        };
    }
    let config = match doc.get("config") {
        Some(c @ Value::Obj(_)) => load_config(stable(c)),
        _ => false,
    };
    RestoreResult {
        ok: true,
        entries: n as u32,
        config,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOC: &str = r#"{"app":"dahonghua","entries":[{"id":"e1","amt":35.5,"note":"午饭"}]}"#;

    #[test]
    fn a_sealed_backup_opens_with_its_password() {
        let env = encrypt_backup(DOC.to_string(), "correct horse".into());
        assert!(!env.is_empty());
        assert!(is_encrypted_doc(env.clone()));
        // The plaintext must not be sitting in the envelope.
        assert!(!env.contains("午饭"));
        assert!(!env.contains("35.5"));

        let out = decrypt_backup(env, "correct horse".into());
        assert!(out.ok, "{}", out.error);
        assert_eq!(out.json, DOC);
    }

    #[test]
    fn a_wrong_password_is_refused_rather_than_half_restored() {
        let env = encrypt_backup(DOC.to_string(), "correct horse".into());
        let out = decrypt_backup(env, "wrong".into());
        assert!(!out.ok);
        assert!(out.json.is_empty());
        assert!(!out.error.is_empty());
    }

    #[test]
    fn two_backups_of_the_same_document_do_not_match() {
        // Random salt and nonce. Two files with the same password and the
        // same bytes must still be different files — otherwise a leak of one
        // is a leak of every future backup.
        let a = encrypt_backup(DOC.to_string(), "pw".into());
        let b = encrypt_backup(DOC.to_string(), "pw".into());
        assert_ne!(a, b);
        assert_eq!(decrypt_backup(a, "pw".into()).json, DOC);
        assert_eq!(decrypt_backup(b, "pw".into()).json, DOC);
    }

    #[test]
    fn an_empty_password_refuses_to_seal() {
        assert_eq!(encrypt_backup(DOC.to_string(), String::new()), "");
    }

    #[test]
    fn a_plain_document_is_not_an_envelope() {
        assert!(!is_encrypted_doc(DOC.to_string()));
        assert!(!is_encrypted_doc("[]".to_string()));
        let out = decrypt_backup(DOC.to_string(), "pw".into());
        assert!(!out.ok);
    }
}
