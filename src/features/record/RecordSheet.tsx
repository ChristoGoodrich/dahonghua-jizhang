import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAnimatedValue } from '@/hooks/useAnimatedValue';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from '@/components/Flower';
import { Chip } from '@/components/ui/Chip';
import { Btn } from '@/components/ui/Btn';
import { RAD, SPRING, TABULAR, shadow } from '@/theme/tokens';
import { allCats, catName, catOf } from '@/domain/cats';
import { toBase, curSymbol } from '@/domain/money';
import { evalExpr, hasOperator, applyKey } from '@/domain/calc';
import { pickerAccounts, pickerLedgers } from '@/domain/archive';
import type { Category, IO } from '@/domain/types';
import type { Lang } from '@/i18n';
import { I18N } from '@/i18n';
import { store$, addEntry, addTransfer, updateEntry, removeEntry, addTemplate } from '@/store/ledger';
import { noteSuggestions } from '@/domain/notes';
import { NO_ANIM } from '@/util/boot';
import { CalcKeypad } from './CalcKeypad';
import { AIQuickEntry } from './AIQuickEntry';
import { CurrencyRow } from './CurrencyRow';
import { CategoryPicker } from './CategoryPicker';
import { TransferForm } from './TransferForm';
import { DateField } from './DateField';
import { aiConfigured, parseEntryText } from '@/ai/client';

interface Props {
  visible: boolean;
  editId: string | null;
  /** Pre-picked date for a NEW entry (e.g. calendar 补记这天); null = now. */
  initialTs?: number | null;
  /** Copy an existing entry's fields into a NEW entry (再记一笔). Ignored when editId is set. */
  dupeId?: string | null;
  lang: Lang;
  customCats: Record<IO, Category[]>;
  onClose: () => void;
  // keepOpen=true means the sheet stays up (再记); the host should skip
  // celebration UI that the sheet overlay would cover anyway.
  onSaved: (isNew: boolean, keepOpen?: boolean) => void;
  onTemplateSaved?: () => void;
  // Called after a delete with a restore fn, so the host can offer an undo toast.
  onDeleted?: (restore: () => void) => void;
}

export function RecordSheet({ visible, editId, initialTs, dupeId, lang, customCats, onClose, onSaved, onTemplateSaved, onDeleted }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const s = I18N[lang];
  const accounts = store$.accounts.get();
  const tags = store$.tags.get();
  const currencies = store$.currencies.get();
  const subcats = store$.subcats.get();
  const base = currencies.base || 'CNY';
  const rateCodes = Object.keys(currencies.rates || {});
  const [io, setIO] = useState<IO>('exp');
  const [cat, setCat] = useState('food');
  const [amt, setAmt] = useState('');
  const [note, setNote] = useState('');
  const [acct, setAcct] = useState('default');
  const [acctTo, setAcctTo] = useState('');
  const [fee, setFee] = useState('');
  const [discount, setDiscount] = useState('');
  const [sheetTags, setSheetTags] = useState<string[]>([]);
  const [ledger, setLedger] = useState('');
  const [cur, setCur] = useState(base);
  const [subcat, setSubcat] = useState('');
  // null = "now" — materialized at save time so the entry carries the moment it
  // was saved, and render stays pure (no Date.now() during render)
  const [ts, setTs] = useState<number | null>(null);
  const [flash, setFlash] = useState('');
  const [aiText, setAiText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState('');

  // transient 再记 confirmation — cleared by timer, timer cleared on unmount
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(''), 1600);
    return () => clearTimeout(id);
  }, [flash]);

  // archived accounts/ledgers drop out of the pickers, but a currently-selected
  // one stays (editing an old entry that lives on an archived account/ledger)
  const visibleAccts = pickerAccounts(accounts, [acct, acctTo]);
  const visibleLedgers = pickerLedgers(tags.ledger, store$.settings.archivedLedgers.get() ?? [], ledger);

  // entrance: mask fades in while the sheet springs up from below
  const enter = useAnimatedValue(NO_ANIM ? 1 : 0);
  useEffect(() => {
    if (!visible || NO_ANIM) return;
    enter.setValue(0);
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, ...SPRING.soft }).start();
  }, [visible, enter]);

  async function runAI() {
    const text = aiText.trim();
    if (!text || aiBusy) return;
    setAiBusy(true);
    setAiMsg('');
    try {
      const shareCats = store$.settings.aiShareCategories.peek() !== false; // default on
      const draft = await parseEntryText(text, customCats, lang, shareCats);
      if (!draft) {
        setAiMsg(s.aiUnconfigured);
      } else {
        setIO(draft.io);
        setCat(draft.cat);
        setAmt(draft.amt);
        if (draft.note) setNote(draft.note);
        setAiText('');
      }
    } catch {
      setAiMsg(s.aiFailed);
    } finally {
      setAiBusy(false);
    }
  }

  // Re-initialize the form whenever the sheet opens or switches target entry.
  // Adjusted during render (guarded by initKey) rather than in an effect, so
  // the first visible frame already shows the right values — and creating a
  // category mid-entry no longer wipes the half-typed form.
  const [initKey, setInitKey] = useState<string | null>(null);
  // dupeId encodes into the key so opening a duplicate re-inits even though it's
  // a NEW entry (editId null); a plain new-entry open uses ''.
  const formKey = visible ? (editId ?? (dupeId ? 'd' + dupeId : '')) : null;
  if (initKey !== formKey) {
    setInitKey(formKey);
    if (formKey !== null) {
      setAiText('');
      setAiMsg('');
      const baseNow = store$.currencies.base.peek() || 'CNY';
      // edit loads the target; duplicate copies a source entry's fields into a
      // fresh entry (editId stays null → saves via addEntry, dated today)
      const srcId = editId ?? dupeId ?? null;
      const d = srcId ? store$.data.peek().find((x) => x.id === srcId) : undefined;
      setFlash('');
      if (d) {
        setIO(d.io);
        setCat(d.cat);
        setTs(editId ? d.ts : initialTs ?? null); // dupe keeps no date → "now"
        // show the original foreign amount when editing a converted entry
        setAmt(String(d.origAmt ?? d.amt));
        setNote(d.note ?? '');
        setAcct(d.acct ?? 'default');
        setAcctTo(d.acctTo ?? '');
        setFee(d.fee ? String(d.fee) : '');
        setDiscount(d.discount ? String(d.discount) : '');
        setSheetTags(d.tags ?? []);
        setLedger(d.ledger ?? '');
        setCur(d.cur ?? baseNow);
        setSubcat(d.subcat ?? '');
      } else {
        setIO('exp');
        setCat(allCats('exp', customCats)[0].k);
        setTs(initialTs ?? null);
        setAmt('');
        setNote('');
        setAcct(store$.curAccount.peek());
        setAcctTo('');
        setFee('');
        setDiscount('');
        setSheetTags([]);
        setLedger(store$.curLedger.peek() || '');
        setCur(baseNow);
        setSubcat('');
      }
    }
  }

  function pickIO(next: IO) {
    setIO(next);
    setSubcat('');
    if (next === 'xfer') {
      const from = acct || store$.curAccount.peek();
      const to = visibleAccts.find((a) => a.id !== from);
      setAcct(from);
      setAcctTo(to ? to.id : '');
      return;
    }
    setCat(allCats(next, customCats)[0].k);
  }

  function onKey(k: string) {
    setAmt((prev) => applyKey(prev, k));
  }

  // Write the entry (add or update). Returns the amount as typed (in the
  // entry's own currency) for feedback, or null when the form isn't saveable.
  function writeEntry(): number | null {
    const value = evalExpr(amt);
    if (!value || value <= 0) return null;
    const trimmed = note.trim();
    // only patch ts on edit when the user actually re-dated the entry, so an
    // untouched date doesn't get a fresh fieldTs stamp for sync merging
    const origTs = editId ? store$.data.peek().find((x) => x.id === editId)?.ts : undefined;
    const tsPatch = ts !== null && origTs !== undefined && origTs !== ts ? { ts } : {};

    if (io === 'xfer') {
      if (!acctTo || acct === acctTo) return null; // need two distinct accounts
      const feeN = parseFloat(fee) || 0;
      const discN = parseFloat(discount) || 0;
      if (editId) {
        updateEntry(editId, {
          io: 'xfer', cat: 'transfer', amt: value, acct, acctTo,
          fee: feeN || undefined, discount: discN || undefined,
          note: trimmed || undefined, ledger: ledger || undefined,
          // clear exp/inc-only fields if an entry was converted into a transfer
          subcat: undefined, cur: undefined, origAmt: undefined,
          ...tsPatch,
        });
      } else {
        addTransfer({ from: acct, to: acctTo, amt: value, fee: feeN, discount: discN, note: trimmed, ledger, ts: ts ?? undefined });
      }
      return value;
    }

    const storeAmt = toBase(value, cur, currencies); // always persist in base currency
    const foreign = cur && cur !== base;
    const extra = {
      tags: sheetTags.length ? sheetTags : undefined,
      ledger: ledger || undefined,
      subcat: subcat || undefined,
      cur: foreign ? cur : undefined,
      origAmt: foreign ? value : undefined,
    };
    if (editId) {
      updateEntry(editId, { io, cat, amt: storeAmt, note: trimmed, acct, ...extra, ...tsPatch });
    } else {
      addEntry({ io, cat, amt: storeAmt, note: trimmed, acct, ...extra, ts: ts ?? undefined });
    }
    return value;
  }

  function save() {
    if (writeEntry() === null) return;
    onSaved(!editId);
    onClose();
  }

  // 再记 — save and keep the sheet open for the next entry of the same kind:
  // io/category/account/currency/date/tags/ledger stay, amount+note+subcat clear.
  function saveNext() {
    const value = writeEntry();
    if (value === null) return;
    onSaved(true, true);
    setAmt('');
    setNote('');
    setSubcat('');
    setFee('');
    setDiscount('');
    setFlash(s.savedNext.replace('%s', curSymbol(cur) + value.toFixed(2)));
  }

  function saveAsTemplate() {
    const value = evalExpr(amt);
    if (!value || value <= 0) return;
    const trimmed = note.trim();
    const c = catOf(io, cat, customCats);
    addTemplate({ io, cat, amt: value, note: trimmed, name: trimmed || catName(c, lang) });
    onTemplateSaved?.();
    onClose();
  }

  function toggleTag(g: string) {
    setSheetTags((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
  }

  function del() {
    if (editId) {
      // Snapshot before the tombstone so the host's undo toast can restore
      // the entry (and any refund bookkeeping removeEntry rewrote) verbatim.
      const prev = store$.data.peek();
      removeEntry(editId);
      onDeleted?.(() => store$.data.set(prev));
    }
    onClose();
  }

  const accent = io === 'inc' ? t.leaf : t.hibiscus;
  // auto-learned note chips for the selected category (frequency + recency)
  const noteSugg = io === 'xfer' || !visible ? [] : noteSuggestions(store$.data.get(), io, cat);
  const converted =
    cur !== base && !!evalExpr(amt)
      ? s.curConverted.replace('%s', curSymbol(base) + toBase(evalExpr(amt), cur, currencies).toFixed(2))
      : undefined;

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: enter }]}>
        <Pressable
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
            styles.sheet,
            { backgroundColor: t.paper, paddingBottom: Math.max(26, insets.bottom + 12) },
            shadow(t, 'lg'),
            {
              opacity: enter.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }),
              // clamp so the spring's overshoot can't lift the sheet off the bottom edge
              transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [56, 0], extrapolate: 'clamp' }) }],
            },
          ]}
        >
          <View style={[styles.grip, { backgroundColor: t.line }]} />

          <View style={[styles.toggle, { backgroundColor: t.isDark ? '#151312' : t.paperWarm, borderColor: t.line }]}>
            {(['exp', 'inc', 'xfer'] as IO[]).map((k) => (
              <Pressable
                key={k}
                onPress={() => pickIO(k)}
                style={[
                  styles.toggleBtn,
                  io === k && [styles.toggleOn, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'xs')],
                ]}
                accessibilityRole="tab"
                accessibilityState={{ selected: io === k }}
              >
                <Text
                  style={[
                    styles.toggleText,
                    { color: io === k ? (k === 'inc' ? t.leafDeep : k === 'exp' ? t.hibiscus : t.ink) : t.inkSoft },
                  ]}
                >
                  {k === 'exp' ? s.exp : k === 'inc' ? s.inc : s.xfer}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.amtRow} accessible accessibilityLabel={`${s.amountPh}: ${amt || '0'} ${curSymbol(cur)}`}>
            <Text style={[styles.cur, { color: accent }]}>{curSymbol(cur)}</Text>
            <Text
              style={[styles.amtInput, TABULAR, { color: amt ? t.ink : t.line }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {amt || s.amountPh}
            </Text>
          </View>
          {/* fixed-height slot: live "=" preview while typing math, or the 再记
              confirmation — constant height so the layout never jumps mid-entry */}
          <View style={styles.subLine}>
            {hasOperator(amt) ? (
              <Text style={[styles.subLineText, TABULAR, { color: t.inkSoft }]}>
                = {curSymbol(cur)}{evalExpr(amt).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </Text>
            ) : flash ? (
              <Text style={[styles.subLineText, { color: t.leafDeep }]}>{flash}</Text>
            ) : null}
          </View>

          <ScrollView style={styles.middle} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {io !== 'xfer' && aiConfigured() && (
              <AIQuickEntry value={aiText} busy={aiBusy} msg={aiMsg} onChangeText={setAiText} onSubmit={runAI} lang={lang} />
            )}

            {io !== 'xfer' && (
              <>
                {rateCodes.length > 0 && (
                  <CurrencyRow cur={cur} codes={[base, ...rateCodes]} onPick={setCur} convertedLabel={converted} />
                )}
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
              </>
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

          {/* secondary actions sit beside save — one row instead of two */}
          <View style={styles.actions}>
            {!editId && io !== 'xfer' && (
              <Btn label={s.tmplSaveBtn} onPress={saveAsTemplate} variant="ghost" style={styles.secondaryBtn} />
            )}
            {!editId && (
              <Btn label={s.saveNext} onPress={saveNext} variant="ghost" style={styles.secondaryBtn} />
            )}
            {!!editId && (
              <Btn label={s.del} onPress={del} variant="ghost" tone={t.hibiscusDeep} style={styles.secondaryBtn} />
            )}
            <Btn
              label={s.save}
              onPress={save}
              gradient={io === 'inc' ? [t.leaf, t.leafDeep] : [t.gradFrom, t.gradTo]}
              leading={<Flower size={20} petal="#fff" stamen="#fff" />}
              style={styles.primaryBtn}
            />
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, elevation: 50 },
  mask: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: RAD.xl, borderTopRightRadius: RAD.xl,
    padding: 22, paddingTop: 12, paddingBottom: 26, maxHeight: '94%',
    // match the app column on wide screens (DetailSheet/MarkSheet do the same)
    maxWidth: 480, width: '100%', alignSelf: 'center',
  },
  grip: { width: 40, height: 4.5, borderRadius: 4, alignSelf: 'center', marginBottom: 12 },
  toggle: {
    flexDirection: 'row', borderRadius: RAD.sm, padding: 3, marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toggleBtn: { flex: 1, paddingVertical: 8, borderRadius: RAD.sm - 3, alignItems: 'center' },
  toggleOn: { borderWidth: StyleSheet.hairlineWidth },
  toggleText: { fontSize: 13.5, fontWeight: '700' },
  // symbol + number sit together as one centered group (no full-width flex,
  // which would park the symbol at the screen edge)
  amtRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 6, marginBottom: 2, paddingHorizontal: 24 },
  cur: { fontSize: 22, fontWeight: '700' },
  amtInput: { fontSize: 42, fontWeight: '800', letterSpacing: -0.8, flexShrink: 1, textAlign: 'center', padding: 0 },
  subLine: { minHeight: 18, marginBottom: 4, justifyContent: 'center' },
  subLineText: { fontSize: 11.5, fontWeight: '600', textAlign: 'center' },
  middle: { flexShrink: 1, marginTop: 4, marginBottom: 6 },
  pickLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 7 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 12 },
  note: {
    borderWidth: StyleSheet.hairlineWidth, borderRadius: RAD.sm,
    padding: 12, paddingHorizontal: 14, fontSize: 14, marginBottom: 12,
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4, alignItems: 'stretch' },
  // tight horizontal padding so three-across still fits a 375pt sheet
  secondaryBtn: { flex: 1, paddingHorizontal: 6 },
  primaryBtn: { flex: 1.9 },
});
