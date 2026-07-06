import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Tap } from '@/components/ui/Tap';
import { tapHaptic } from '@/util/haptics';
import { I18N, type Lang } from '@/i18n';
import { RAD } from '@/theme/tokens';

interface Props {
  lang: Lang;
  onResult: (text: string) => void;
}

// Inline microphone SVG — the Icon set doesn't include a mic glyph.
function MicSvg({ color, size = 20 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{
        width: size * 0.45, height: size * 0.65,
        borderRadius: size * 0.225, borderWidth: size * 0.08,
        borderColor: color, backgroundColor: 'transparent',
      }} />
      <View style={{
        position: 'absolute', bottom: size * 0.1,
        width: size * 0.55, height: size * 0.28,
        borderRadius: size * 0.14, borderWidth: size * 0.08,
        borderColor: color, backgroundColor: 'transparent',
      }} />
      <View style={{
        position: 'absolute', bottom: 0,
        width: size * 0.08, height: size * 0.18,
        backgroundColor: color, borderRadius: size * 0.04,
      }} />
    </View>
  );
}

/**
 * Voice entry — microphone button with a placeholder speech-to-text flow.
 *
 * Actual speech recognition requires native modules (e.g. expo-speech or
 * @react-native-voice/voice). This component provides the UI shell and
 * fires `onResult` with the recognised text so RecordSheet can feed it
 * into the existing AI parse pipeline.
 */
export function VoiceEntry({ lang, onResult }: Props) {
  const t = useTheme();
  const s = I18N[lang];
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const pulse = useRef(new Animated.Value(1)).current;

  function toggle() {
    tapHaptic();
    if (listening) {
      stopListening();
    } else {
      startListening();
    }
  }

  function startListening() {
    setListening(true);
    setTranscript('');
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.15, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    ).start();

    // TODO: Replace with actual speech recognition native module.
    // Example integration with @react-native-voice/voice:
    //   Voice.onSpeechResults = (e) => { if (e.value?.[0]) setTranscript(e.value[0]); };
    //   Voice.onSpeechEnd = () => { stopListening(); if (transcript) onResult(transcript); };
    //   await Voice.start(lang === 'zh' ? 'zh-CN' : 'en-US');
    //
    // For now, simulate a short listening period then stop.
    setTimeout(() => {
      if (transcript) onResult(transcript);
      stopListening();
    }, 3000);
  }

  function stopListening() {
    setListening(false);
    pulse.stopAnimation();
    pulse.setValue(1);
  }

  const label = lang === 'zh' ? '语音记账' : 'Voice entry';

  return (
    <View style={styles.wrap}>
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <Tap
          onPress={toggle}
          scaleTo={0.88}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={[styles.btn, { backgroundColor: listening ? t.hibiscus : t.card, borderColor: t.line }]}
        >
          <MicSvg color={listening ? '#fff' : t.inkSoft} size={20} />
        </Tap>
      </Animated.View>
      <View style={styles.textCol}>
        {listening ? (
          <Text style={[styles.statusText, { color: t.hibiscus }]}>
            {lang === 'zh' ? '正在听…' : 'Listening…'}
          </Text>
        ) : !!transcript ? (
          <Text style={[styles.transcript, { color: t.ink }]} numberOfLines={2}>
            {transcript}
          </Text>
        ) : (
          <Text style={[styles.hint, { color: t.inkSoft }]}>
            {lang === 'zh' ? '点击麦克风，说出金额' : 'Tap mic, speak amount'}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginBottom: 10, paddingHorizontal: 2,
  },
  btn: {
    width: 40, height: 40, borderRadius: RAD.sm,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  textCol: { flex: 1 },
  statusText: { fontSize: 13, fontWeight: '600' },
  transcript: { fontSize: 13, fontWeight: '500' },
  hint: { fontSize: 12.5 },
});
