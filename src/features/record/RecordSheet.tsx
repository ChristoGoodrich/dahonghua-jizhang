import React from 'react';
import { observer } from '@legendapp/state/react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, Animated,
} from 'react-native';
import { Chip } from '@/components/ui/Chip';
import { RAD, shadow } from '@/theme/tokens';
import { CalcKeypad } from './CalcKeypad';
import { AIQuickEntry } from './AIQuickEntry';
import { CategoryPicker } from './CategoryPicker';
import { TransferForm } from './TransferForm';
import { DateField } from './DateField';
import { aiConfigured } from '@/ai/client';
import { receiptAiConfigured } from '@/ai/receipt';
import { ReceiptScan, ReceiptPreview } from './ReceiptScan';
import { useRecordForm, type RecordFormProps } from './hooks/useRecordForm';
import { RecordHeader } from './RecordHeader';
import { RecordAmount } from './RecordAmount';
import { RecordActions } from './RecordActions';
import { Glass } from '@/components/ui/Glass';

// Re-export Props so external callers can import from this module
export type Props = RecordFormProps;

// observer(): the component reads store$ (accounts, tags, currencies, subcats…)
// with .get(), but those reads only subscribe inside an observer. Unwrapped it
// re-rendered solely because its parent did, so tag/currency/subcat edits made
// on another screen didn't reach the open sheet.
export const RecordSheet = observer(function RecordSheet(props: Props) {
  const { visible, editId, lang, customCats, onClose } = props;
  const {
    // theme / i18n / layout
    t, insets, s,
    // store reads
    tags, subcats, base, rateCodes,
    // form state
    io, cat, amt, note, acct, acctTo, fee, discount, sheetTags, ledger, cur, subcat, ts,
    flash, aiText, aiBusy, aiMsg, curDropdown, receiptUri, receiptBusy, attempted,
    // animation
    enter,
    // derived
    accent, noteSugg, converted, visibleAccts, visibleLedgers,
    // setters
    setCat, setNote, setAcct, setSubcat, setTs, setCur, setCurDropdown,
    setAiText, setReceiptUri, setAcctTo, setFee, setDiscount, setLedger,
    // handlers
    runAI, handleReceiptCapture, pickIO, onKey, save, saveNext, saveAsTemplate, toggleTag, del,
  } = useRecordForm(props);

  if (!visible) return null;

  return (
    <View testID="record-sheet" style={styles.overlay}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: enter }]}>
        <Pressable
          testID="record-sheet-close"
          style={[styles.mask, { backgroundColor: t.overlay }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={s.back}
        />
      </Animated.View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetWrap}
        pointerEvents="box-none"
      >
        <Animated.View
          style={[
            styles.sheetShadow,
            { zIndex: 10 },
            shadow(t, 'lg'),
            {
              opacity: enter.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }),
              // clamp so the spring's overshoot can't lift the sheet off the bottom edge
              transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [56, 0], extrapolate: 'clamp' }) }],
            },
          ]}
        >
        {/* 柔光玻璃, sheet level — same material as SheetShell; this screen keeps
            its own chrome only because it has to sit inside KeyboardAvoidingView. */}
        <Glass
          level="sheet"
          under={t.paper}
          density={0.6}
          style={[styles.sheet, { paddingBottom: Math.max(26, insets.bottom + 12) }]}
        >
          <RecordHeader io={io} onPickIO={pickIO} t={t} s={s} />

          <RecordAmount
            amt={amt} cur={cur} base={base} accent={accent}
            attempted={attempted} flash={flash}
            curDropdown={curDropdown} setCurDropdown={setCurDropdown}
            rateCodes={rateCodes} setCur={setCur}
            converted={converted} t={t} s={s}
          />

          <ScrollView style={styles.middle} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {io !== 'xfer' && aiConfigured() && (
              <AIQuickEntry value={aiText} busy={aiBusy} msg={aiMsg} onChangeText={setAiText} onSubmit={runAI} lang={lang} />
            )}

            {/* Receipt scanning */}
            {io !== 'xfer' && receiptAiConfigured() && (
              <>
                {receiptUri && <ReceiptPreview uri={receiptUri} busy={receiptBusy} onRemove={() => setReceiptUri(null)} lang={lang} />}
                <ReceiptScan lang={lang} onCapture={handleReceiptCapture} busy={receiptBusy || aiBusy} />
              </>
            )}

            {io !== 'xfer' && (
              <CategoryPicker
                io={io}
                cat={cat}
                onPickCat={(k) => { setCat(k); setSubcat(''); }}
                subcat={subcat}
                onPickSubcat={setSubcat}
                acct={acct}
                onPickAcct={setAcct}
                accounts={visibleAccts}
                subcats={subcats}
                customCats={customCats}
                lang={lang}
              />
            )}

            {io === 'xfer' && (
              <TransferForm
                accounts={visibleAccts}
                acct={acct}
                acctTo={acctTo}
                fee={fee}
                discount={discount}
                setAcct={setAcct}
                setAcctTo={setAcctTo}
                setFee={setFee}
                setDiscount={setDiscount}
                lang={lang}
              />
            )}

            <DateField ts={ts} onChange={setTs} lang={lang} />

            <TextInput
              style={[styles.note, { backgroundColor: t.card, borderColor: t.line, color: t.ink }]}
              value={note}
              onChangeText={setNote}
              placeholder={s.note}
              placeholderTextColor={t.inkSoft}
              accessibilityLabel={s.note}
            />

            {noteSugg.length > 0 && (
              <View style={styles.tagWrap}>
                {noteSugg.map((n) => (
                  <Chip key={n} label={n} on={note === n} onPress={() => setNote(note === n ? '' : n)} />
                ))}
              </View>
            )}

            {io !== 'xfer' && tags.normal.length > 0 && (
              <>
                <Text style={[styles.pickLabel, { color: t.inkSoft }]}>{s.tagPick}</Text>
                <View style={styles.tagWrap}>
                  {tags.normal.map((g) => (
                    <Chip key={g} label={g} on={sheetTags.includes(g)} onPress={() => toggleTag(g)} />
                  ))}
                </View>
              </>
            )}

            {visibleLedgers.length > 0 && (
              <>
                <Text style={[styles.pickLabel, { color: t.inkSoft }]}>{s.ledgerPick}</Text>
                <View style={styles.tagWrap}>
                  {visibleLedgers.map((g) => {
                    const on = ledger === g;
                    return <Chip key={g} label={g} on={on} dashed onPress={() => setLedger(on ? '' : g)} />;
                  })}
                </View>
              </>
            )}
          </ScrollView>

          <CalcKeypad onKey={onKey} lang={lang} />

          <RecordActions
            editId={editId} io={io}
            onSaveAsTemplate={saveAsTemplate} onSaveNext={saveNext}
            onDelete={del} onSave={save} t={t} s={s}
          />
        </Glass>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
});

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, elevation: 50 },
  mask: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  // shadow + column sizing on a plain wrapper: a shadow on the glass surface
  // itself would be clipped by its own overflow:hidden
  sheetShadow: {
    borderTopLeftRadius: RAD.xl, borderTopRightRadius: RAD.xl,
    maxHeight: '94%',
    // match the app column on wide screens (DetailSheet/MarkSheet do the same)
    maxWidth: 480, width: '100%', alignSelf: 'center',
  },
  sheet: {
    borderTopLeftRadius: RAD.xl, borderTopRightRadius: RAD.xl,
    padding: 22, paddingTop: 12, paddingBottom: 26,
    width: '100%',
  },
  middle: { flexShrink: 1, marginTop: 4, marginBottom: 6 },
  pickLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 7 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 12 },
  note: {
    borderWidth: StyleSheet.hairlineWidth, borderRadius: RAD.sm,
    padding: 12, paddingHorizontal: 14, fontSize: 14, marginBottom: 12,
  },
});
