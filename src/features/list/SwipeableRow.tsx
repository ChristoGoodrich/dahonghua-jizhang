import React, { useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Swipeable, RectButton } from 'react-native-gesture-handler';
import { useTheme } from '@/theme/ThemeContext';
import { Icon } from '@/components/ui/Icon';
import { I18N, type Lang } from '@/i18n';

interface Props {
  children: React.ReactNode;
  onDelete?: () => void;
  onEdit?: () => void;
  lang?: Lang;
}

const ACTION_W = 64;

export function SwipeableRow({ children, onDelete, onEdit, lang = 'zh' }: Props) {
  const t = useTheme();
  const s = I18N[lang];
  const ref = useRef<Swipeable>(null);

  const close = () => ref.current?.close();

  const renderRightActions = (
    _progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>,
  ) => {
    const scale = dragX.interpolate({
      inputRange: [-ACTION_W * 2, 0],
      outputRange: [1, 0.6],
      extrapolate: 'clamp',
    });

    return (
      <View style={styles.actions}>
        {onEdit && (
          <RectButton
            style={[styles.btn, { backgroundColor: t.hibiscus + '18' }]}
            onPress={() => { close(); onEdit(); }}
            accessibilityRole="button"
            accessibilityLabel={s.a11ySwipeEdit}
          >
            <Animated.View style={{ transform: [{ scale }] }}>
              <Icon name="edit" color={t.hibiscus} size={20} />
            </Animated.View>
          </RectButton>
        )}
        {onDelete && (
          <RectButton
            style={[styles.btn, { backgroundColor: '#E53935' + '18' }]}
            onPress={() => { close(); onDelete(); }}
            accessibilityRole="button"
            accessibilityLabel={s.a11ySwipeDelete}
          >
            <Animated.View style={{ transform: [{ scale }] }}>
              <Icon name="trash" color="#E53935" size={20} />
            </Animated.View>
          </RectButton>
        )}
      </View>
    );
  };

  return (
    <Swipeable
      ref={ref}
      friction={2}
      rightThreshold={32}
      overshootRight={false}
      renderRightActions={renderRightActions}
    >
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  btn: {
    width: ACTION_W,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
