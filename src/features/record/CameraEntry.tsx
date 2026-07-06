import React, { useState } from 'react';
import { View, Text, StyleSheet, Image, Alert, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@/theme/ThemeContext';
import { Tap } from '@/components/ui/Tap';
import { tapHaptic } from '@/util/haptics';
import { I18N, type Lang } from '@/i18n';
import { RAD } from '@/theme/tokens';

interface Props {
  lang: Lang;
  onResult: (imageUri: string, recognizedText?: string) => void;
}

function CameraSvg({ color, size = 20 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{
        width: size * 0.8, height: size * 0.55,
        borderRadius: size * 0.1, borderWidth: size * 0.07,
        borderColor: color, backgroundColor: 'transparent',
      }}>
        <View style={{
          position: 'absolute', top: size * -0.12, left: size * 0.22,
          width: size * 0.3, height: size * 0.12,
          borderTopLeftRadius: size * 0.04, borderTopRightRadius: size * 0.04,
          borderLeftWidth: size * 0.07, borderRightWidth: size * 0.07,
          borderTopWidth: size * 0.07, borderColor: color, backgroundColor: 'transparent',
        }} />
        <View style={{
          position: 'absolute', top: size * 0.1, left: size * 0.15,
          width: size * 0.22, height: size * 0.22,
          borderRadius: size * 0.11, borderWidth: size * 0.06,
          borderColor: color, backgroundColor: 'transparent',
        }} />
      </View>
    </View>
  );
}

function GallerySvg({ color, size = 20 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{
        width: size * 0.75, height: size * 0.6,
        borderRadius: size * 0.08, borderWidth: size * 0.07,
        borderColor: color, backgroundColor: 'transparent',
        overflow: 'hidden',
      }}>
        <View style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: size * 0.25,
          backgroundColor: color, opacity: 0.3,
        }} />
        <View style={{
          position: 'absolute', top: size * 0.08, left: size * 0.08,
          width: size * 0.14, height: size * 0.14,
          borderRadius: size * 0.07, backgroundColor: color, opacity: 0.5,
        }} />
      </View>
    </View>
  );
}

/**
 * Camera entry — camera and gallery buttons with image preview.
 *
 * Actual OCR requires native ML Kit integration. This component provides
 * the UI shell and fires `onResult` with the image URI and optional
 * recognized text so RecordSheet can feed it into the AI parse pipeline.
 */
export function CameraEntry({ lang, onResult }: Props) {
  const t = useTheme();
  const s = I18N[lang];
  const [image, setImage] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  async function takePicture() {
    tapHaptic();

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        lang === 'zh' ? '需要相机权限' : 'Camera permission required',
        lang === 'zh' ? '请在设置中允许访问相机' : 'Please allow camera access in settings',
      );
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: true,
    });

    if (!result.canceled && result.assets[0]) {
      handleImage(result.assets[0].uri);
    }
  }

  async function pickImage() {
    tapHaptic();

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: true,
    });

    if (!result.canceled && result.assets[0]) {
      handleImage(result.assets[0].uri);
    }
  }

  function handleImage(uri: string) {
    setImage(uri);
    setProcessing(true);

    // Placeholder: actual OCR requires native ML Kit or similar integration.
    // For now, pass the image URI back without recognized text.
    setTimeout(() => {
      onResult(uri);
      setProcessing(false);
    }, 800);
  }

  const hint = lang === 'zh' ? '拍照或从相册选取小票' : 'Take a photo or pick from gallery';

  return (
    <View style={styles.wrap}>
      <View style={styles.btnRow}>
        <Tap
          onPress={takePicture}
          scaleTo={0.88}
          accessibilityRole="button"
          accessibilityLabel={lang === 'zh' ? '拍照' : 'Take photo'}
          style={[styles.btn, { backgroundColor: t.hibiscus }]}
        >
          <CameraSvg color="#fff" size={20} />
        </Tap>
        <Tap
          onPress={pickImage}
          scaleTo={0.88}
          accessibilityRole="button"
          accessibilityLabel={lang === 'zh' ? '相册' : 'Gallery'}
          style={[styles.btn, { backgroundColor: t.card, borderColor: t.line }]}
        >
          <GallerySvg color={t.inkSoft} size={20} />
        </Tap>
        <View style={styles.textCol}>
          {processing ? (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color={t.inkSoft} />
              <Text style={[styles.statusText, { color: t.inkSoft }]}>
                {lang === 'zh' ? '识别中…' : 'Processing…'}
              </Text>
            </View>
          ) : !!image ? (
            <Text style={[styles.statusText, { color: t.ink }]} numberOfLines={1}>
              {lang === 'zh' ? '已选择图片' : 'Image selected'}
            </Text>
          ) : (
            <Text style={[styles.hint, { color: t.inkSoft }]}>{hint}</Text>
          )}
        </View>
      </View>

      {!!image && !processing && (
        <View style={styles.previewWrap}>
          <Image source={{ uri: image }} style={styles.preview} resizeMode="cover" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 10, paddingHorizontal: 2 },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  btn: {
    width: 40, height: 40, borderRadius: RAD.sm,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent',
  },
  textCol: { flex: 1 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { fontSize: 13, fontWeight: '600' },
  hint: { fontSize: 12.5 },
  previewWrap: { marginTop: 10, borderRadius: RAD.sm, overflow: 'hidden' },
  preview: { width: '100%', height: 140, borderRadius: RAD.sm },
});
