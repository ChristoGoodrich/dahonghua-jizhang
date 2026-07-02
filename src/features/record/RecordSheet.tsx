import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from '@/components/Flower';
import { allCats, catName, catOf } from '@/domain/cats';
import { toBase, curSymbol } from '@/domain/money';
import { evalExpr, hasOperator, applyKey } from '@/domain/calc';
import type { Category, IO } from '@/domain/types';
import type { Lang } from '@/i18n';
import { I18N } from '@/i18n';
import { store$, addEntry, addTransfer, updateEntry, removeEntry, addTemplate } from '@/store/ledger';
import { CalcKeypad } from './CalcKeypad';
import { AIQuickEntry } from './AIQuickEntry';
import { CurrencyRow } from './CurrencyRow';
import { CategoryPicker } from './CategoryPicker';
import { TransferForm } from './TransferForm';
import { aiConfigured, parseEntryText } from '@/ai/client';

interface Props {
  visible: boolean;
  editId: string | null;
  lang: Lang;
  customCats: Record<IO, Category[]>;
  onClose: () => void;
  onSaved: (isNew: boolean) => void;
  onTemplateSaved?: () => void;
  // Called after a delete with a restore fn, so the host can offer an undo toast.
  onDeleted?: (restore: () => void) => void;
}

export function RecordSheet({ visible, editId, lang, customCats, onClose, onSaved, onTemplateSaved, onDeleted }: Props) {
  const t = useTheme();
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
  const [aiText, setAiText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState('');

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

  useEffect(() => {
    if (!visible) return;
    setAiText('');
    setAiMsg('');
    const baseNow = store$.currencies.base.peek() || 'CNY';
    if (editId) {
      const d = store$.data.peek().find((x) => x.id === editId);
      if (d) {
        setIO(d.io);
        setCat(d.cat);
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
        return;
      }
    }
    setIO('exp');
    setCat(allCats('exp', customCats)[0].k);
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
  }, [visible, editId, customCats]);

  function pickIO(next: IO) {
    setIO(next);
    setSubcat('');
    if (next === 'xfer') {
      const from = acct || store$.curAccount.peek();
      const to = accounts.find((a) => a.id !== from);
      setAcct(from);
      setAcctTo(to ? to.id : '');
      return;
    }
    setCat(allCats(next, customCats)[0].k);
  }

  function onKey(k: string) {
    setAmt((prev) => applyKey(prev, k));
  }

  function save() {
    const value = evalExpr(amt);
    if (!value || value <= 0) return;
    const trimmed = note.trim();
    const isNew = !editId;

    if (io === 'xfer') {
      if (!acctTo || acct === acctTo) return; // need two distinct accounts
      const feeN = parseFloat(fee) || 0;
      const discN = parseFloat(discount) || 0;
      if (editId) {
        updateEntry(editId, {
          io: 'xfer', cat: 'transfer', amt: value, acct, acctTo,
          fee: feeN || undefined, discount: discN || undefined,
          note: trimmed || undefined, ledger: ledger || undefined,
          // clear exp/inc-only fields if an entry was converted into a transfer
          subcat: undefined, cur: undefined, origAmt: undefined,
        });
      } else {
        addTransfer({ from: acct, to: acctTo, amt: value, fee: feeN, discount: discN, note: trimmed, ledger });
      }
      onSaved(isNew);
      onClose();
      return;
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
      updateEntry(editId, { io, cat, amt: storeAmt, note: trimmed, acct, ...extra });
    } else {
      addEntry({ io, cat, amt: storeAmt, note: trimmed, acct, ...extra });
    }
    onSaved(isNew);
    onClose();
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
  const converted =
    cur !== base && !!evalExpr(amt)
      ? s.curConverted.replace('%s', curSymbol(base) + toBase(evalExpr(amt), cur, currencies).toFixed(2))
      : undefined;

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.mask} onPress={onClose} accessibilityRole="button" accessibilityLabel={s.back} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetWrap}
        pointerEvents="box-none"
      >
        <View style={[styles.sheet, { backgroundColor: t.paper }]}>
          <View style={[styles.grip, { backgroundColor: t.line }]} />

          <View style={[styles.toggle, { backgroundColor: t.line }]}>
            {(['exp', 'inc', 'xfer'] as IO[]).map((k) => (
              <Pressable
                key={k}
                onPress={() => pickIO(k)}
                style={[styles.toggleBtn, io === k && { backgroundColor: t.card }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: io === k }}
              >
                <Text
                  style={[
                    styles.toggleText,
                    { color: io === k ? (k === 'inc' ? t.leafDeep : t.ink) : t.inkSoft },
                  ]}
                >
                  {k === 'exp' ? s.exp : k === 'inc' ? s.inc : s.xfer}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.amtRow}>
            <Text style={[styles.cur, { color: t.inkSoft }]}>{curSymbol(cur)}</Text>
            <Text
              style={[styles.amtInput, { color: amt ? t.ink : t.inkSoft }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {amt || s.amountPh}
            </Text>
          </View>
          {hasOperator(amt) && (
            <Text style={[styles.convLine, { color: t.inkSoft }]}>
              = {curSymbol(cur)}{evalExpr(amt).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
          )}

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
                  accounts={accounts}
                  subcats={subcats}
                  customCats={customCats}
                  lang={lang}
                />
              </>
            )}

            {io === 'xfer' && (
              <TransferForm
                accounts={accounts}
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

            <TextInput
              style={[styles.note, { backgroundColor: t.card, borderColor: t.line, color: t.ink }]}
              value={note}
              onChangeText={setNote}
              placeholder={s.note}
              placeholderTextColor={t.inkSoft}
            />

            {io !== 'xfer' && tags.normal.length > 0 && (
              <>
                <Text style={[styles.pickLabel, { color: t.inkSoft }]}>{s.tagPick}</Text>
                <View style={styles.tagWrap}>
                  {tags.normal.map((g) => {
                    const on = sheetTags.includes(g);
                    return (
                      <Pressable key={g} onPress={() => toggleTag(g)} style={[styles.tagChip, { borderColor: on ? t.hibiscus : t.line, backgroundColor: on ? t.paperWarm : t.card }]}>
                        <Text style={{ fontSize: 12.5, fontWeight: '600', color: on ? t.hibiscus : t.inkSoft }}>{g}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            {tags.ledger.length > 0 && (
              <>
                <Text style={[styles.pickLabel, { color: t.inkSoft }]}>{s.ledgerPick}</Text>
                <View style={styles.tagWrap}>
                  {tags.ledger.map((g) => {
                    const on = ledger === g;
                    return (
                      <Pressable key={g} onPress={() => setLedger(on ? '' : g)} style={[styles.tagChip, styles.ledgerChip, { borderColor: on ? t.hibiscus : t.line, backgroundColor: on ? t.paperWarm : t.card }]}>
                        <Text style={{ fontSize: 12.5, fontWeight: '600', color: on ? t.hibiscus : t.inkSoft }}>{g}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}
          </ScrollView>

          <CalcKeypad onKey={onKey} lang={lang} />

          <Pressable style={[styles.save, { backgroundColor: accent }]} onPress={save}>
            <Flower size={20} petal="#fff" stamen="#fff" />
            <Text style={styles.saveText}>{s.save}</Text>
          </Pressable>

          {!editId && io !== 'xfer' && (
            <Pressable style={[styles.del, { borderColor: t.line }]} onPress={saveAsTemplate}>
              <Text style={[styles.delText, { color: t.hibiscus }]}>{s.tmplSaveBtn}</Text>
            </Pressable>
          )}

          {!!editId && (
            <Pressable style={[styles.del, { borderColor: t.line }]} onPress={del}>
              <Text style={[styles.delText, { color: t.hibiscus }]}>{s.del}</Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, elevation: 50 },
  mask: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(43,38,34,0.4)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingTop: 12, paddingBottom: 26, maxHeight: '94%' },
  grip: { width: 38, height: 4, borderRadius: 4, alignSelf: 'center', marginBottom: 10 },
  toggle: { flexDirection: 'row', borderRadius: 11, padding: 3, marginBottom: 10 },
  toggleBtn: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  toggleText: { fontSize: 13.5, fontWeight: '600' },
  amtRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 4, marginBottom: 2 },
  cur: { fontSize: 22, fontWeight: '600' },
  amtInput: { fontSize: 38, fontWeight: '700', flex: 1, textAlign: 'center', padding: 0 },
  convLine: { fontSize: 11, fontWeight: '600', textAlign: 'center', marginBottom: 10 },
  middle: { flexShrink: 1, marginTop: 4, marginBottom: 6 },
  pickLabel: { fontSize: 11, fontWeight: '600', marginBottom: 6 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 12 },
  tagChip: { borderWidth: 1, borderRadius: 18, paddingVertical: 6, paddingHorizontal: 12 },
  ledgerChip: { borderStyle: 'dashed' },
  note: { borderWidth: 1, borderRadius: 11, padding: 11, paddingHorizontal: 13, fontSize: 14, marginBottom: 12 },
  save: { flexDirection: 'row', borderRadius: 13, padding: 14, alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4 },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  del: { borderWidth: 1, borderRadius: 13, padding: 11, alignItems: 'center', marginTop: 8 },
  delText: { fontSize: 13, fontWeight: '600' },
});
