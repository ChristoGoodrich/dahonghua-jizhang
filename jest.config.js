module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  // pure domain logic runs fine in node; component tests can opt into jsdom later
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.js'],
  coverageReporters: ['text', 'json-summary', 'lcov'],
};
