// Jest config for the stateful half of the parity harness.
//
// `src/store/state.ts` imports AsyncStorage, so the TypeScript side of a
// ledger comparison cannot run under plain tsx the way the pure modules do —
// it needs jest's module mocks. This config exists only so `npm run parity`
// can invoke those files; they are kept out of `jest.config.js`'s testMatch so
// `npm test` neither runs them nor counts them.
module.exports = {
  ...require('./jest.config.js'),
  testMatch: ['<rootDir>/scripts/*.harness.ts'],
  collectCoverage: false,
};
