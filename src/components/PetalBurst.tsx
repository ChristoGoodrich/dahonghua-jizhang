import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from './Flower';

interface Props {
  /** Called after the last petal fades so the host can unmount us. */
  onDone: () => void;
}

interface Spec {
  size: number;
  petal: string;
  stamen: string;
  dx: number; // horizontal drift
  rise: number; // peak height
  rot: string; // total rotation
  duration: number;
  delay: number;
}

const COUNT = 12;

/** A brief burst of mini flowers from the FAB — the reward for planting one.
 *  Pure transform/opacity animation on the native driver; unmounts itself. */
export function PetalBurst({ onDone }: Props) {
  const t = useTheme();

  const specs = useMemo<Spec[]>(() => {
    const hues = [
      { petal: t.hibiscus, stamen: t.stamen },
      { petal: t.hibiscusSoft, stamen: t.stamen },
      { petal: t.leaf, stamen: t.leafDeep },
      { petal: t.stamen, stamen: t.hibiscus },
    ];
    return Array.from({ length: COUNT }, (_, i) => {
      const hue = hues[i % hues.length];
      const spread = (i / (COUNT - 1)) * 2 - 1; // -1..1 fan
      return {
        size: 9 + Math.random() * 8,
        petal: hue.petal,
        stamen: hue.stamen,
        dx: spread * (70 + Math.random() * 50),
        rise: 90 + Math.random() * 80,
        rot: `${(Math.random() * 280 - 140).toFixed(0)}deg`,
        duration: 750 + Math.random() * 300,
        delay: Math.random() * 120,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const anims = useRef(specs.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const runs = specs.map((sp, i) =>
      Animated.timing(anims[i], {
        toValue: 1,
        duration: sp.duration,
        delay: sp.delay,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    Animated.parallel(runs).start(({ finished }) => {
      if (finished) onDone();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.stage} pointerEvents="none">
      {specs.map((sp, i) => {
        const v = anims[i];
        return (
          <Animated.View
            key={i}
            style={[
              styles.petal,
              {
                opacity: v.interpolate({
                  inputRange: [0, 0.08, 0.7, 1],
                  outputRange: [0, 1, 1, 0],
                  extrapolate: 'clamp',
                }),
                transform: [
                  { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, sp.dx] }) },
                  {
                    // rise fast, then drift down a little — a petal's arc
                    translateY: v.interpolate({
                      inputRange: [0, 0.62, 1],
                      outputRange: [0, -sp.rise, -sp.rise + 30],
                    }),
                  },
                  { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', sp.rot] }) },
                  { scale: v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.3, 1, 0.9], extrapolate: 'clamp' }) },
                ],
              },
            ]}
          >
            <Flower size={sp.size} petal={sp.petal} stamen={sp.stamen} />
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 96, // just above the FAB, where the flower is "planted"
    alignItems: 'center',
    zIndex: 45,
    elevation: 45,
  },
  petal: { position: 'absolute', bottom: 0 },
});
