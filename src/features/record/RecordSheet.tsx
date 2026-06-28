import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Flower } from '@/components/Flower';
import { allCats, catName, catOf, EMOJI_POOL } from '@/domain/cats';
import { toBase, curSymbol } from '@/domain/money';
import { evalExpr, hasOperator, applyKey } from '@/domain/calc';
import type { Category, IO } from '@/domain/types';
import type { Lang } from '@/i18n';
import { I18N } from '@/i18n';
import { store$, addEntry, addTransfer, updateEntry, removeEntry, addCustomCat, addTemplate, addSubcat, removeSubcat } from '@/store/ledger';
import { CalcKeypad } from './CalcKeypad';

interface Props {
  visible: boolean;
  editId: string | null;
  lang: Lang;
  customCats: Record<IO, Category[]>;
  onClose: () => void;
  onSaved: (isNew: boolean) => void;
  onTemplateSaved?: () => void;
}

export function RecordSheet({ visible, editId, lang, customCats, onClose, onSaved, onTemplateSaved }: Props) {
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
  const [addingSubcat, setAddingSubcat] = useState(false);
  const [newSubcatName, setNewSubcatName] = useState('');
  const [addingCat, setAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatEmoji, setNewCatEmoji] = useState(EMOJI_POOL[0]);

  useEffect(() => {
    if (!visible) return;
    setAddingCat(false);
    setNewCatName('');
    setAddingSubcat(false);
    setNewSubcatName('');
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

  const cats = allCats(io, customCats);

  function pickIO(next: IO) {
    setIO(next);
    setAddingCat(false);
    setSubcat('');
    setAddingSubcat(false);
    if (next === 'xfer') {
      const from = acct || store$.curAccount.peek();
      const to = accounts.find((a) => a.id !== from);
      setAcct(from);
      setAcctTo(to ? to.id : '');
      return;
    }
    setCat(allCats(next, customCats)[0].k);
  }

  function pickCat(k: string) {
    setCat(k);
    setSubcat('');
    setAddingSubcat(false);
  }

  function createSubcat() {
    const nm = newSubcatName.trim().replace(/[<>]/g, '').slice(0, 16);
    if (!nm) return;
    addSubcat(cat, nm);
    setNewSubcatName('');
    setAddingSubcat(false);
  }

  function onKey(k: string) {
    setAmt((prev) => applyKey(prev, k));
  }

  function createCat() {
    const nm = newCatName.trim().replace(/[<>]/g, '').slice(0, 24);
    if (!nm) return;
    const c = addCustomCat(io, nm, newCatEmoji);
    setCat(c.k);
    setAddingCat(false);
    setNewCatName('');
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
    if (editId) removeEntry(editId);
    onClose();
  }

  const accent = io === 'inc' ? t.leaf : t.hibiscus;

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.mask} onPress={onClose} />
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
          {io !== 'xfer' && (
            <>
          {rateCodes.length > 0 && (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={styles.curRow}>
                {[base, ...rateCodes].map((c) => {
                  const on = c === cur;
                  return (
                    <Pressable key={c} onPress={() => setCur(c)} style={[styles.curChip, { borderColor: on ? t.hibiscus : t.line, backgroundColor: on ? t.paperWarm : t.card }]}>
                      <Text style={{ fontSize: 12.5, fontWeight: '700', color: on ? t.hibiscus : t.inkSoft }}>{curSymbol(c)}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              {cur !== base && !!evalExpr(amt) && (
                <Text style={[styles.convLine, { color: t.hibiscus }]}>
                  {s.curConverted.replace('%s', curSymbol(base) + toBase(evalExpr(amt), cur, currencies).toFixed(2))}
                </Text>
              )}
            </>
          )}

          <View style={styles.catScroll}>
            <View style={styles.cats}>
              {cats.map((c) => {
                const on = c.k === cat;
                return (
                  <Pressable
                    key={c.k}
                    onPress={() => pickCat(c.k)}
                    style={[styles.catPick, on && { borderColor: t.hibiscus }]}
                  >
                    <View style={[styles.catEmo, { backgroundColor: t.card }]}>
                      <Text style={styles.catEmoText}>{c.e}</Text>
                    </View>
                    <Text
                      style={[styles.catName, { color: on ? t.hibiscus : t.inkSoft }]}
                      numberOfLines={1}
                    >
                      {catName(c, lang)}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable style={styles.catPick} onPress={() => setAddingCat((v) => !v)}>
                <View style={[styles.catEmo, styles.catEmoAdd, { backgroundColor: t.paperWarm, borderColor: t.line }]}>
                  <Text style={[styles.catEmoText, { color: t.inkSoft }]}>＋</Text>
                </View>
                <Text style={[styles.catName, { color: t.inkSoft }]}>{s.newCat}</Text>
              </Pressable>
            </View>
          </View>

          {addingCat && (
            <View style={[styles.catForm, { borderColor: t.line }]}>
              <TextInput
                style={[styles.field, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
                placeholder={s.catNamePh}
                placeholderTextColor={t.inkSoft}
                value={newCatName}
                onChangeText={setNewCatName}
              />
              <View style={styles.emojiRow}>
                {EMOJI_POOL.slice(0, 16).map((e) => (
                  <Pressable
                    key={e}
                    onPress={() => setNewCatEmoji(e)}
                    style={[styles.emojiBtn, { backgroundColor: t.card, borderColor: newCatEmoji === e ? t.hibiscus : t.line }]}
                  >
                    <Text style={{ fontSize: 18 }}>{e}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable style={[styles.save, { backgroundColor: t.hibiscus }]} onPress={createCat}>
                <Text style={styles.saveText}>{s.catCreate}</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.subcatWrap}>
            <View style={styles.subcatChips}>
              {(subcats[cat] ?? []).map((sc) => {
                const on = subcat === sc.k;
                return (
                  <Pressable
                    key={sc.k}
                    onPress={() => setSubcat(on ? '' : sc.k)}
                    onLongPress={() => removeSubcat(cat, sc.k)}
                    delayLongPress={500}
                    style={[styles.tagChip, { borderColor: on ? t.hibiscus : t.line, backgroundColor: on ? t.paperWarm : t.card }]}
                  >
                    <Text style={{ fontSize: 12.5, fontWeight: '600', color: on ? t.hibiscus : t.inkSoft }}>{sc.name}</Text>
                  </Pressable>
                );
              })}
              <Pressable onPress={() => setAddingSubcat((v) => !v)} style={[styles.tagChip, styles.ledgerChip, { borderColor: t.line, backgroundColor: t.card }]}>
                <Text style={{ fontSize: 12.5, fontWeight: '600', color: t.inkSoft }}>{s.subcatAdd}</Text>
              </Pressable>
            </View>
            {addingSubcat && (
              <View style={styles.subcatForm}>
                <TextInput
                  style={[styles.field, { flex: 1, borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
                  placeholder={s.subcatName}
                  placeholderTextColor={t.inkSoft}
                  value={newSubcatName}
                  onChangeText={setNewSubcatName}
                />
                <Pressable style={[styles.subcatSave, { backgroundColor: t.hibiscus }]} onPress={createSubcat}>
                  <Text style={styles.saveText}>{s.catCreate}</Text>
                </Pressable>
              </View>
            )}
          </View>

          {accounts.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.acctRow} keyboardShouldPersistTaps="handled">
              {accounts.map((a) => {
                const on = a.id === acct;
                const nm = lang === 'zh' ? a.name : a.nameEn || a.name;
                return (
                  <Pressable
                    key={a.id}
                    onPress={() => setAcct(a.id)}
                    style={[styles.acctChip, { borderColor: on ? t.hibiscus : t.line, backgroundColor: on ? t.paperWarm : t.card }]}
                  >
                    <Text style={{ fontSize: 12.5, fontWeight: '600', color: on ? t.hibiscus : t.inkSoft }}>{nm}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
            </>
          )}

          {io === 'xfer' && (
            accounts.length < 2 ? (
              <Text style={[styles.convLine, { color: t.inkSoft, marginVertical: 16 }]}>{s.xferNeedAccts}</Text>
            ) : (
              <View style={styles.xferWrap}>
                <Text style={[styles.pickLabel, { color: t.inkSoft }]}>{s.xferFrom}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.acctRow} keyboardShouldPersistTaps="handled">
                  {accounts.map((a) => {
                    const on = a.id === acct;
                    const nm = lang === 'zh' ? a.name : a.nameEn || a.name;
                    return (
                      <Pressable
                        key={a.id}
                        onPress={() => {
                          setAcct(a.id);
                          if (a.id === acctTo) {
                            const o = accounts.find((x) => x.id !== a.id);
                            setAcctTo(o ? o.id : '');
                          }
                        }}
                        style={[styles.acctChip, { borderColor: on ? t.hibiscus : t.line, backgroundColor: on ? t.paperWarm : t.card }]}
                      >
                        <Text style={{ fontSize: 12.5, fontWeight: '600', color: on ? t.hibiscus : t.inkSoft }}>{nm}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <Text style={[styles.pickLabel, { color: t.inkSoft }]}>{s.xferTo}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.acctRow} keyboardShouldPersistTaps="handled">
                  {accounts.filter((a) => a.id !== acct).map((a) => {
                    const on = a.id === acctTo;
                    const nm = lang === 'zh' ? a.name : a.nameEn || a.name;
                    return (
                      <Pressable
                        key={a.id}
                        onPress={() => setAcctTo(a.id)}
                        style={[styles.acctChip, { borderColor: on ? t.hibiscus : t.line, backgroundColor: on ? t.paperWarm : t.card }]}
                      >
                        <Text style={{ fontSize: 12.5, fontWeight: '600', color: on ? t.hibiscus : t.inkSoft }}>{nm}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <View style={styles.xferFeeRow}>
                  <View style={styles.xferFeeCol}>
                    <Text style={[styles.pickLabel, { color: t.inkSoft }]}>{s.xferFee}</Text>
                    <TextInput
                      style={[styles.field, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
                      value={fee}
                      onChangeText={(v) => setFee(v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1'))}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={t.inkSoft}
                    />
                  </View>
                  <View style={styles.xferFeeCol}>
                    <Text style={[styles.pickLabel, { color: t.inkSoft }]}>{s.xferDiscount}</Text>
                    <TextInput
                      style={[styles.field, { borderColor: t.line, color: t.ink, backgroundColor: t.card }]}
                      value={discount}
                      onChangeText={(v) => setDiscount(v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1'))}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={t.inkSoft}
                    />
                  </View>
                </View>
              </View>
            )
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

          <CalcKeypad onKey={onKey} />

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
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 32, maxHeight: '92%' },
  grip: { width: 38, height: 4, borderRadius: 4, alignSelf: 'center', marginBottom: 16 },
  toggle: { flexDirection: 'row', borderRadius: 11, padding: 3, marginBottom: 16 },
  toggleBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  toggleText: { fontSize: 13.5, fontWeight: '600' },
  amtRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginVertical: 10 },
  cur: { fontSize: 26, fontWeight: '600' },
  amtInput: { fontSize: 46, fontWeight: '700', flex: 1, textAlign: 'center', padding: 0 },
  middle: { flexShrink: 1, marginBottom: 6 },
  catScroll: { marginBottom: 12 },
  cats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catPick: {
    width: '18%', alignItems: 'center', gap: 5, paddingVertical: 9,
    borderRadius: 12, borderWidth: 1.5, borderColor: 'transparent',
  },
  catEmo: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  catEmoAdd: { borderWidth: 1.5, borderStyle: 'dashed' },
  catEmoText: { fontSize: 20 },
  catName: { fontSize: 10.5 },
  catForm: { borderWidth: 1, borderRadius: 13, padding: 12, marginBottom: 12, gap: 10 },
  field: { borderWidth: 1, borderRadius: 11, padding: 11, fontSize: 14 },
  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  emojiBtn: { width: 38, height: 38, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  acctRow: { marginBottom: 12 },
  acctChip: { borderWidth: 1.5, borderRadius: 20, paddingVertical: 7, paddingHorizontal: 13, marginRight: 7 },
  pickLabel: { fontSize: 11, fontWeight: '600', marginBottom: 6 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 12 },
  tagChip: { borderWidth: 1, borderRadius: 18, paddingVertical: 6, paddingHorizontal: 12 },
  ledgerChip: { borderStyle: 'dashed' },
  curRow: { flexGrow: 0, marginBottom: 8 },
  curChip: { borderWidth: 1.5, borderRadius: 18, paddingVertical: 6, paddingHorizontal: 13, marginRight: 7 },
  convLine: { fontSize: 11, fontWeight: '600', textAlign: 'center', marginBottom: 10 },
  xferWrap: { marginBottom: 12, gap: 6 },
  xferFeeRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  xferFeeCol: { flex: 1, gap: 5 },
  subcatWrap: { marginBottom: 12 },
  subcatChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  subcatForm: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  subcatSave: { borderRadius: 11, paddingVertical: 11, paddingHorizontal: 16, alignItems: 'center' },
  note: { borderWidth: 1, borderRadius: 11, padding: 11, paddingHorizontal: 13, fontSize: 14, marginBottom: 16 },
  save: { flexDirection: 'row', borderRadius: 13, padding: 15, alignItems: 'center', justifyContent: 'center', gap: 8 },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  del: { borderWidth: 1, borderRadius: 13, padding: 12, alignItems: 'center', marginTop: 10 },
  delText: { fontSize: 13, fontWeight: '600' },
});
