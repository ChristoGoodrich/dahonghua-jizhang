// AsyncStorage isn't a real native module under Jest — use its official mock so
// modules that import it (the ledger store) load cleanly in the node test env.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
