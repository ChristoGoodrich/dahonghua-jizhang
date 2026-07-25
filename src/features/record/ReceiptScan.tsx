import React, { useState } from 'react';
import { View, Text, StyleSheet, Image, Pressable } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Icon } from '@/components/ui/Icon';
import { RAD, shadow } from '@/theme/tokens';
import type { Lang } from '@/i18n';
import { I18N } from '@/i18n';

interface Props {
  lang: Lang;
  onCapture: (uri: string) => void;
  busy: boolean;
}

/** Camera / gallery button row for receipt scanning. */
export function ReceiptScan({ lang, onCapture, busy }: Props) {
  const t = useTheme();
  const s = I18N[lang];
  const [error, setError] = useState('');

  async function pickImage(useCamera: boolean) {
    if (busy) return;
    setError('');
    try {
      const ImagePicker = await import('expo-image-picker');
      let result;
      if (useCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          setError(s.cameraPermission);
          return;
        }
        result = await ImagePicker.launchCameraAsync({ quality: 0.8, base64: false });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, base64: false });
      }
      if (!result.canceled && result.assets?.[0]?.uri) {
        onCapture(result.assets[0].uri);
      }
    } catch {
      setError(s.cameraPermissionDesc);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Pressable
          style={[styles.btn, { backgroundColor: t.card, borderColor: t.line }]}
          onPress={() => pickImage(true)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={s.cameraTake}
        >
          <Icon name="camera" color={t.hibiscus} size={18} />
          <Text style={[styles.btnText, { color: t.ink }]}>{s.cameraTake}</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, { backgroundColor: t.card, borderColor: t.line }]}
          onPress={() => pickImage(false)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={s.cameraGallery}
        >
          <Icon name="gallery" color={t.hibiscus} size={18} />
          <Text style={[styles.btnText, { color: t.ink }]}>{s.cameraGallery}</Text>
        </Pressable>
      </View>
      {!!error && <Text style={[styles.error, { color: t.hibiscus }]}>{error}</Text>}
    </View>
  );
}

interface PreviewProps {
  uri: string;
  busy: boolean;
  onRemove: () => void;
}

/** Small image preview with remove button. */
export function ReceiptPreview({ uri, busy, onRemove }: PreviewProps) {
  const t = useTheme();
  return (
    <View style={styles.preview}>
      <Image source={{ uri }} style={styles.previewImg} resizeMode="cover" />
      {!busy && (
        <Pressable style={[styles.removeBtn, { backgroundColor: t.hibiscus }]} onPress={onRemove} hitSlop={8}>
          <Icon name="close" color="#fff" size={12} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  row: { flexDirection: 'row', gap: 10 },
  btn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderRadius: RAD.sm, paddingVertical: 12, paddingHorizontal: 14,
  },
  btnText: { fontSize: 13, fontWeight: '600' },
  error: { fontSize: 11, marginTop: 6, textAlign: 'center' },
  preview: { position: 'relative', alignSelf: 'center', marginBottom: 12 },
  previewImg: { width: 200, height: 120, borderRadius: RAD.sm },
  removeBtn: {
    position: 'absolute', top: -6, right: -6,
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
});
