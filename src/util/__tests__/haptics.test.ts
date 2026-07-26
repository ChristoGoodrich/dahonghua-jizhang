import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { tapHaptic } from '../haptics';

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(),
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
}));

describe('tapHaptic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls selectionAsync on native platforms', () => {
    Platform.OS = 'ios' as any;
    tapHaptic();
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it('is a no-op on web', () => {
    Platform.OS = 'web' as any;
    tapHaptic();
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  });

  it('does not throw if expo-haptics is unavailable', () => {
    Platform.OS = 'android' as any;
    jest.spyOn(Haptics, 'selectionAsync').mockImplementation(() => {
      throw new Error('unavailable');
    });
    expect(() => tapHaptic()).not.toThrow();
  });
});
