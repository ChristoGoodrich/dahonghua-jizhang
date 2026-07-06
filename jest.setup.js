// AsyncStorage isn't a real native module under Jest — use its official mock so
// modules that import it (the ledger store) load cleanly in the node test env.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

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
