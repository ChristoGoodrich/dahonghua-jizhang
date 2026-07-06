// AsyncStorage isn't a real native module under Jest — use its official mock so
// modules that import it (the ledger store) load cleanly in the node test env.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// expo-file-system mock — in-memory store backed by a plain object
jest.mock('expo-file-system', () => {
  const mockFsStore = new Map();
  const BASE = 'file:///mock-docs/';
  return {
    documentDirectory: BASE,
    getInfoAsync: async (uri) => {
      const isDir = [...mockFsStore.keys()].some((k) => k.startsWith(uri) && k !== uri);
      return { exists: mockFsStore.has(uri) || isDir, isDirectory: isDir };
    },
    makeDirectoryAsync: async (uri) => { mockFsStore.set(uri + '/', ''); },
    readAsStringAsync: async (uri) => mockFsStore.get(uri) ?? '',
    writeAsStringAsync: async (uri, contents) => { mockFsStore.set(uri, contents); },
    readDirectoryAsync: async (uri) => {
      const prefix = uri.endsWith('/') ? uri : uri + '/';
      const names = [];
      for (const key of mockFsStore.keys()) {
        if (key.startsWith(prefix) && key !== prefix) {
          names.push(key.slice(prefix.length).split('/')[0]);
        }
      }
      return [...new Set(names)];
    },
    deleteAsync: async (uri) => { mockFsStore.delete(uri); },
  };
});
jest.mock('expo-file-system/legacy', () => {
  return jest.requireMock('expo-file-system');
});

// expo-sqlite needs a mock for Jest — create an in-memory SQLite-like interface
jest.mock('expo-sqlite', () => {
  const databases = new Map();
  
  return {
    openDatabaseSync: (name) => {
      if (!databases.has(name)) {
        // Use better-sqlite3 for synchronous in-memory SQLite in tests
        const Database = require('better-sqlite3');
        const db = new Database(':memory:');
        
        databases.set(name, {
          execSync: (sql) => db.exec(sql),
          getFirstSync: (sql, params) => db.prepare(sql).get(...(params || [])),
          getAllSync: (sql, params) => db.prepare(sql).all(...(params || [])),
          runSync: (sql, params) => db.prepare(sql).run(...(params || [])),
          closeSync: () => db.close(),
        });
      }
      return databases.get(name);
    },
  };
});
