// JS-driven Animated springs/timings advance on setTimeout "frames". Tests
// render with react-test-renderer and never unmount, so in-flight animations
// keep scheduling timers past Jest environment teardown and crash the process
// (flaky under --coverage, hard-fails CI). Complete them synchronously instead:
// every suite only asserts settled UI, never mid-animation frames.
const { Animated } = require('react-native');
for (const kind of ['spring', 'timing', 'decay']) {
  const real = Animated[kind].bind(Animated);
  Animated[kind] = (value, config) => {
    const anim = real(value, config);
    anim.start = (cb) => {
      if (config && config.toValue !== undefined) value.setValue(config.toValue);
      if (cb) cb({ finished: true });
    };
    anim.stop = () => {};
    return anim;
  };
}
// A synchronously-completing animation inside Animated.loop would recurse
// forever — loops (VoiceEntry pulse) become inert instead.
Animated.loop = () => ({ start: () => {}, stop: () => {}, reset: () => {} });

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

// expo-print mock
jest.mock('expo-print', () => ({
  printToFileAsync: async ({ html }) => ({ uri: 'file:///mock-print/output.pdf' }),
}));

// expo-sharing mock
jest.mock('expo-sharing', () => ({
  isAvailableAsync: async () => true,
  shareAsync: async (uri) => {},
}));
