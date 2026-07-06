import { initDatabase, getDatabase } from '../db';

describe('Database', () => {
  beforeEach(() => {
    initDatabase();
  });

  it('should initialize database without errors', () => {
    expect(() => initDatabase()).not.toThrow();
  });

  it('should create entries table', () => {
    const db = getDatabase();
    const result = db.getFirstSync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='entries'"
    );
    expect(result?.name).toBe('entries');
  });

  it('should create accounts table', () => {
    const db = getDatabase();
    const result = db.getFirstSync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'"
    );
    expect(result?.name).toBe('accounts');
  });

  it('should create settings table', () => {
    const db = getDatabase();
    const result = db.getFirstSync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='settings'"
    );
    expect(result?.name).toBe('settings');
  });
});
