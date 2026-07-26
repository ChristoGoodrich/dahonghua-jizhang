import { Buffer } from 'buffer';

const SALT_LEN = 16;
const IV_LEN = 12;
const PBKDF2_ITERATIONS = 100_000;
const KEY_LEN = 32; // AES-256

/**
 * Derive an AES-256 key from a password + salt using PBKDF2-SHA256.
 * Works in both Node (tests) and browser/React Native (via expo-crypto polyfill).
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt a UTF-8 string with AES-256-GCM using a password.
 *
 * Output format (base64): [16-byte salt][12-byte IV][ciphertext+16-byte tag]
 */
export async function encryptBackup(plaintext: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(password, salt);
  const enc = new TextEncoder();
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)),
  );
  const buf = new Uint8Array(SALT_LEN + IV_LEN + ct.length);
  buf.set(salt, 0);
  buf.set(iv, SALT_LEN);
  buf.set(ct, SALT_LEN + IV_LEN);
  return Buffer.from(buf).toString('base64');
}

/**
 * Decrypt a base64 string produced by `encryptBackup`.
 * Throws on wrong password or corrupted data.
 */
export async function decryptBackup(encoded: string, password: string): Promise<string> {
  const raw = new Uint8Array(Buffer.from(encoded, 'base64'));
  if (raw.length < SALT_LEN + IV_LEN + 1) throw new Error('Invalid encrypted data');
  const salt = raw.slice(0, SALT_LEN);
  const iv = raw.slice(SALT_LEN, SALT_LEN + IV_LEN);
  const ct = raw.slice(SALT_LEN + IV_LEN);
  const key = await deriveKey(password, salt);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}
