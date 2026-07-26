import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { observer } from '@legendapp/state/react';
import { store$, importBills } from '@/store/ledger';
import { prepareImport, decodeBillText, type ImportPreview, type BillSource } from '@/domain/billImport';
import { catOf, catName } from '@/domain/cats';
import { fmt } from '@/domain/money';
import { useTheme } from '@/theme/ThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Btn } from '@/components/ui/Btn';
import { RAD, shadow } from '@/theme/tokens';
import { I18N } from '@/i18n';

// Read the picked file as bytes and decode with encoding auto-detection, so
// GBK-encoded Alipay exports import correctly (not just UTF-8 WeChat exports).
async function readFileText(uri: string): Promise<string> {
  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    return decodeBillText(new Uint8Array(await res.arrayBuffer()));
  }
  const FS: any = await import('expo-file-system');
  const file = new FS.File(uri);
  if (typeof file.bytes === 'function') return decodeBillText(await file.bytes());
  return file.text(); // older API: UTF-8 only
}

const PREVIEW_LIMIT = 15;

export default observer(function ImportBillsScreen() {
  const t = useTheme();
  const lang = store$.lang.get();
  const s = I18N[lang];
  const custom = store$.customCats.get();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [status, setStatus] = useState('');

  const sourceLabel = (src: BillSource) =>
    src === 'alipay' ? s.biAlipay : src === 'wechat' ? s.biWechat : s.biGeneric;

  async function pick() {
    setStatus('');
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', '*/*'], copyToCacheDirectory: true });
      if (r.canceled || !r.assets?.length) return;
      setBusy(true);
      const text = await readFileText(r.assets[0].uri);
      // read the store fresh at parse time so dedup sees the latest entries
      setPreview(prepareImport(text, store$.data.peek(), store$.customCats.peek()));
    } catch {
      setPreview(null);
      setStatus(s.importFail);
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    if (!preview) return;
    const n = importBills(preview.fresh);
    setStatus(`${s.biImported} · ${n}`);
    setPreview(null);
  }

  return (
    <View style={[styles.root, { backgroundColor: t.paper }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScreenHeader title={s.billImportTitle} subtitle={s.billImportSub} />
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={[styles.hintCard, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'xs')]}>
            <Text style={[styles.hint, { color: t.inkSoft }]}>{s.biHint}</Text>
          </View>

          <Btn
            label={busy ? s.biParsing : s.biPick}
            onPress={pick}
            disabled={busy}
            leading={busy ? <ActivityIndicator size="small" color="#fff" /> : undefined}
            style={styles.pickBtn}
          />

          {preview && !preview.ok && (
            <Text style={[styles.err, { color: t.hibiscusDeep }]}>{s.biNoHeader}</Text>
          )}

          {preview && preview.ok && (
            <>
              <View style={styles.srcRow}>
                <Text style={[styles.srcLabel, { color: t.inkSoft }]}>{s.biSourceLabel}</Text>
                <View style={[styles.srcChip, { backgroundColor: t.tint, borderColor: t.hibiscus }]}>
                  <Text style={[styles.srcChipText, { color: t.hibiscus }]}>{sourceLabel(preview.source)}</Text>
                </View>
              </View>

              <View style={[styles.summary, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'xs')]}>
                <View style={styles.statRow}>
                  <View style={styles.stat}>
                    <Text style={[styles.statNum, { color: t.ink }]}>{preview.expCount}</Text>
                    <Text style={[styles.statLabel, { color: t.inkSoft }]}>{s.exp}</Text>
                    <Text style={[styles.statSum, { color: t.ink }]}>{fmt(preview.expSum, lang)}</Text>
                  </View>
                  <View style={[styles.statDivider, { backgroundColor: t.line }]} />
                  <View style={styles.stat}>
                    <Text style={[styles.statNum, { color: t.leafDeep }]}>{preview.incCount}</Text>
                    <Text style={[styles.statLabel, { color: t.inkSoft }]}>{s.inc}</Text>
                    <Text style={[styles.statSum, { color: t.leafDeep }]}>{fmt(preview.incSum, lang)}</Text>
                  </View>
                </View>
                {(preview.dupCount > 0 || preview.skipped > 0) && (
                  <Text style={[styles.meta, { color: t.inkSoft }]}>
                    {preview.dupCount > 0 ? `${s.biDup} ${preview.dupCount}` : ''}
                    {preview.dupCount > 0 && preview.skipped > 0 ? '　·　' : ''}
                    {preview.skipped > 0 ? `${s.biSkip} ${preview.skipped}` : ''}
                  </Text>
                )}
                {preview.errors.length > 0 && (
                  <View style={styles.errorSection}>
                    <Text style={[styles.errorHead, { color: t.hibiscusDeep }]}>{s.biErrors}</Text>
                    {preview.errors.slice(0, 10).map((e, i) => (
                      <Text key={i} style={[styles.errorLine, { color: t.inkSoft }]}>
                        {s.biErrorRow.replace('%d', String(e.row))}: {e.reason}
                      </Text>
                    ))}
                    {preview.errors.length > 10 && (
                      <Text style={[styles.errorLine, { color: t.inkSoft }]}>
                        +{preview.errors.length - 10} {s.biMore}
                      </Text>
                    )}
                  </View>
                )}
              </View>

              {preview.fresh.length > 0 ? (
                <>
                  <Text style={[styles.previewHead, { color: t.inkSoft }]}>{s.biPreview}</Text>
                  {preview.fresh.slice(0, PREVIEW_LIMIT).map((c, i) => {
                    const cat = catOf(c.io, c.cat, custom);
                    return (
                      <View key={i} style={[styles.rowCard, { backgroundColor: t.card, borderColor: t.line }]}>
                        <View style={[styles.emojiWrap, { backgroundColor: t.tint }]}>
                          <Text style={styles.emoji}>{cat.e}</Text>
                        </View>
                        <View style={styles.rowMid}>
                          <Text style={[styles.rowNote, { color: t.ink }]} numberOfLines={1}>
                            {c.note || catName(cat, lang)}
                          </Text>
                          <Text style={[styles.rowSub, { color: t.inkSoft }]}>
                            {catName(cat, lang)} · {new Date(c.ts).toLocaleDateString()}
                          </Text>
                        </View>
                        <Text style={[styles.rowAmt, { color: c.io === 'inc' ? t.leafDeep : t.ink }]}>
                          {c.io === 'inc' ? '+' : '-'}{fmt(c.amt, lang)}
                        </Text>
                      </View>
                    );
                  })}
                  {preview.fresh.length > PREVIEW_LIMIT && (
                    <Text style={[styles.moreLine, { color: t.inkSoft }]}>
                      +{preview.fresh.length - PREVIEW_LIMIT} {s.biMore}
                    </Text>
                  )}
                  <Btn label={`${s.biConfirm} · ${preview.fresh.length}`} onPress={confirm} style={styles.confirmBtn} />
                </>
              ) : (
                <Text style={[styles.empty, { color: t.inkSoft }]}>{s.biNothing}</Text>
              )}
            </>
          )}

          {!!status && <Text style={[styles.status, { color: t.leafDeep }]}>{status}</Text>}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, maxWidth: 480, width: '100%', alignSelf: 'center' },
  body: { paddingHorizontal: 22, paddingBottom: 80, paddingTop: 6 },
  hintCard: { borderWidth: 1, borderRadius: RAD.sm, padding: 14, marginTop: 10 },
  hint: { fontSize: 12.5, lineHeight: 19 },
  pickBtn: { marginTop: 14 },
  err: { fontSize: 13, marginTop: 16, textAlign: 'center', fontWeight: '600' },
  srcRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20 },
  srcLabel: { fontSize: 12.5 },
  srcChip: { borderWidth: 1, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 11 },
  srcChipText: { fontSize: 12.5, fontWeight: '700' },
  summary: { borderWidth: 1, borderRadius: RAD.sm, padding: 16, marginTop: 10 },
  statRow: { flexDirection: 'row', alignItems: 'center' },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statDivider: { width: 1, height: 44 },
  statNum: { fontSize: 22, fontWeight: '800' },
  statLabel: { fontSize: 11.5 },
  statSum: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  meta: { fontSize: 11.5, textAlign: 'center', marginTop: 12 },
  errorSection: { marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(0,0,0,0.08)' },
  errorHead: { fontSize: 12, fontWeight: '700', marginBottom: 4 },
  errorLine: { fontSize: 11.5, lineHeight: 18 },
  previewHead: { fontSize: 12, fontWeight: '600', marginTop: 22, marginBottom: 8 },
  rowCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: RAD.sm, padding: 10, marginBottom: 7, gap: 10 },
  emojiWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 18 },
  rowMid: { flex: 1 },
  rowNote: { fontSize: 14, fontWeight: '600' },
  rowSub: { fontSize: 11, marginTop: 2 },
  rowAmt: { fontSize: 14.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  moreLine: { fontSize: 12, textAlign: 'center', marginTop: 4, marginBottom: 4 },
  confirmBtn: { marginTop: 16 },
  empty: { fontSize: 13, textAlign: 'center', marginTop: 24 },
  status: { marginTop: 14, fontSize: 13, fontWeight: '600', textAlign: 'center' },
});
