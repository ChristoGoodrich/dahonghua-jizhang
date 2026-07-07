import { useState } from 'react';
import { Animated } from 'react-native';

/** A stable Animated.Value created once per mount.
 *  Mirrors react-native's useAnimatedValue, which react-native-web doesn't ship.
 *  Backed by lazy useState instead of useRef so render never touches a ref
 *  (keeps components eligible for React Compiler memoization). */
export function useAnimatedValue(initial: number): Animated.Value {
  const [value] = useState(() => new Animated.Value(initial));
  return value;
}
