import { encryptBackup, decryptBackup } from '../crypto';

const SAMPLE = JSON.stringify({ version: 1, timestamp: Date.now(), entries: [{ id: '1', amt: 42 }], config: { theme: 'ocean' } });
const PASSWORD = 'correct-horse-battery-staple';

describe('encryptBackup / decryptBackup roundtrip', () => {
  it('returns a different ciphertext on every call (random salt+IV)', async () => {
    const a = await encryptBackup(SAMPLE, PASSWORD);
    const b = await encryptBackup(SAMPLE, PASSWORD);
    expect(a).not.toBe(b);
  });

  it('decrypts back to the original plaintext', async () => {
    const enc = await encryptBackup(SAMPLE, PASSWORD);
    const dec = await decryptBackup(enc, PASSWORD);
    expect(dec).toBe(SAMPLE);
  });

  it('roundtrips unicode (CJK + emoji)', async () => {
    const cjk = '{"note":"早餐 ¥12.5 🌺"}';
    const enc = await encryptBackup(cjk, PASSWORD);
    expect(await decryptBackup(enc, PASSWORD)).toBe(cjk);
  });

  it('roundtrips an empty string', async () => {
    const enc = await encryptBackup('', PASSWORD);
    expect(await decryptBackup(enc, PASSWORD)).toBe('');
  });
});

describe('wrong password', () => {
  it('throws on incorrect password', async () => {
    const enc = await encryptBackup(SAMPLE, PASSWORD);
    await expect(decryptBackup(enc, 'wrong-password')).rejects.toThrow();
  });
});

describe('corrupted data', () => {
  it('throws on truncated ciphertext', async () => {
    await expect(decryptBackup('YWJj', PASSWORD)).rejects.toThrow();
  });

  it('throws on empty string', async () => {
    await expect(decryptBackup('', PASSWORD)).rejects.toThrow();
  });
});
