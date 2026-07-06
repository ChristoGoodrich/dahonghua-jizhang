jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(),
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
}));

import * as Haptics from 'expo-haptics';
import { tapHaptic } from '../haptics';

describe('tapHaptic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls selectionAsync on native platforms', () => {
    const { Platform } = require('react-native');
    Platform.OS = 'ios';
    tapHaptic();
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it('is a no-op on web', () => {
    const { Platform } = require('react-native');
    Platform.OS = 'web';
    tapHaptic();
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  });

  it('does not throw if expo-haptics is unavailable', () => {
    const { Platform } = require('react-native');
    Platform.OS = 'android';
    jest.spyOn(Haptics, 'selectionAsync').mockImplementation(() => {
      throw new Error('unavailable');
    });
    expect(() => tapHaptic()).not.toThrow();
  });
});
