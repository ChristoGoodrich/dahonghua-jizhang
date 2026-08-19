import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { observer } from '@legendapp/state/react';
import { store$ } from '@/store/ledger';
import { useTheme } from '@/theme/ThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Btn } from '@/components/ui/Btn';
import { Tap } from '@/components/ui/Tap';
import { RAD } from '@/theme/tokens';

const STORAGE_KEY = 'dhh_feedback';

const STRINGS = {
  zh: {
    title: '意见反馈',
    subtitle: '你的每一条建议都会让大红花更好',
    ratingLabel: '你对大红花的满意度',
    commentPh: '说说你的想法、建议或遇到的问题…',
    submit: '提交反馈',
    thanks: '感谢你的反馈！',
    thanksSub: '我们会认真阅读每一条建议 🌺',
    prevFeedback: '你之前的反馈',
    noComment: '无备注',
    a11yRateStars: '评 %d 星',
  },
  en: {
    title: 'Feedback',
    subtitle: 'Every suggestion helps Red Blossom grow',
    ratingLabel: 'How satisfied are you?',
    commentPh: 'Share your thoughts, suggestions, or issues…',
    submit: 'Submit feedback',
    thanks: 'Thank you for your feedback!',
    thanksSub: 'We read every suggestion 🌺',
    prevFeedback: 'Your previous feedback',
    noComment: 'No comment',
    a11yRateStars: 'Rate %d stars',
  },
};

interface FeedbackEntry {
  rating: number;
  comment: string;
  timestamp: number;
  version: string;
}

export default observer(function FeedbackScreen() {
  const t = useTheme();
  const lang = store$.lang.get();
  const s = STRINGS[lang];

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [prevFeedback, setPrevFeedback] = useState<FeedbackEntry[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try { setPrevFeedback(JSON.parse(raw)); } catch { /* ignore */ }
      }
    });
  }, []);

  async function onSubmit() {
    if (rating === 0) return;
    const entry: FeedbackEntry = {
      rating,
      comment: comment.trim(),
      timestamp: Date.now(),
      version: '1.0.0',
    };
    const updated = [entry, ...prevFeedback];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setPrevFeedback(updated);
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <View style={[styles.root, { backgroundColor: t.paper }]}>
        <SafeAreaView edges={['top']} style={styles.safe}>
          <ScreenHeader title={s.title} />
          <View style={styles.thanksWrap}>
            <Text style={styles.bloom}>🌺</Text>
            <Text style={[styles.thanksTitle, { color: t.ink }]}>{s.thanks}</Text>
            <Text style={[styles.thanksSub, { color: t.inkSoft }]}>{s.thanksSub}</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScreenHeader title={s.title} subtitle={s.subtitle} />
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Text style={[styles.label, { color: t.inkSoft }]}>{s.ratingLabel}</Text>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((i) => (
              <Tap
                key={i}
                onPress={() => setRating(i)}
                scaleTo={0.8}
                hitSlop={6}
                accessibilityRole="radio"
                accessibilityState={{ selected: i === rating }}
                accessibilityLabel={s.a11yRateStars.replace('%d', String(i))}
              >
                <Text style={[styles.star, { color: i <= rating ? t.stamen : t.line }]}>★</Text>
              </Tap>
            ))}
          </View>

          <TextInput
            style={[styles.input, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
            placeholder={s.commentPh}
            placeholderTextColor={t.inkSoft}
            value={comment}
            onChangeText={setComment}
            multiline
            textAlignVertical="top"
          />

          <Btn
            label={s.submit}
            onPress={onSubmit}
            disabled={rating === 0}
            style={{ marginTop: 20 }}
          />

          {prevFeedback.length > 0 && (
            <View style={styles.history}>
              <Text style={[styles.historyTitle, { color: t.inkSoft }]}>{s.prevFeedback}</Text>
              {prevFeedback.slice(0, 3).map((fb, idx) => (
                <View key={idx} style={[styles.historyItem, { borderBottomColor: t.line }]}>
                  <Text style={{ color: t.stamen }}>{'★'.repeat(fb.rating)}{'☆'.repeat(5 - fb.rating)}</Text>
                  <Text style={[styles.historyComment, { color: t.inkSoft }]}>
                    {fb.comment || s.noComment}
                  </Text>
                  <Text style={[styles.historyDate, { color: t.inkSoft }]}>
                    {new Date(fb.timestamp).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US')}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, maxWidth: 480, width: '100%', alignSelf: 'center' },
  body: { paddingHorizontal: 22, paddingBottom: 60, paddingTop: 6 },
  label: { fontSize: 12, fontWeight: '600', marginTop: 12, marginBottom: 10 },
  stars: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  star: { fontSize: 36 },
  input: {
    borderWidth: 1, borderRadius: RAD.xs, padding: 14,
    fontSize: 14, minHeight: 120,
  },
  thanksWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 80 },
  bloom: { fontSize: 64 },
  thanksTitle: { fontSize: 22, fontWeight: '800', marginTop: 16 },
  thanksSub: { fontSize: 13, marginTop: 6 },
  history: { marginTop: 32 },
  historyTitle: { fontSize: 12, fontWeight: '600', marginBottom: 10 },
  historyItem: { paddingVertical: 10, borderBottomWidth: 1, gap: 4 },
  historyComment: { fontSize: 13 },
  historyDate: { fontSize: 11 },
});
