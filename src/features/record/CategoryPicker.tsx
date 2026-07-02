import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { allCats, catName, EMOJI_POOL } from '@/domain/cats';
import { addCustomCat, addSubcat, removeSubcat } from '@/store/ledger';
import { EmojiPicker } from './EmojiPicker';
import type { Account, Category, IO } from '@/domain/types';
import { I18N, type Lang } from '@/i18n';

interface Props {
  io: IO;
  cat: string;
  onPickCat: (k: string) => void;
  subcat: string;
  onPickSubcat: (k: string) => void;
  acct: string;
  onPickAcct: (id: string) => void;
  accounts: Account[];
  subcats: Record<string, { k: string; name: string }[]>;
  customCats: Record<IO, Category[]>;
  lang: Lang;
}

/** Category grid (+ create), per-category subcategory chips (+ create), and the
 *  account selector — the expense/income branch of the record sheet. The
 *  ephemeral "add" forms own their own state; the active selection is controlled. */
export function CategoryPicker({
  io, cat, onPickCat, subcat, onPickSubcat, acct, onPickAcct, accounts, subcats, customCats, lang,
}: Props) {
  const t = useTheme();
  const s = I18N[lang];
  const cats = allCats(io, customCats);

  const [addingCat, setAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatEmoji, setNewCatEmoji] = useState(EMOJI_POOL[0]);
  const [addingSubcat, setAddingSubcat] = useState(false);
  const [newSubcatName, setNewSubcatName] = useState('');

  // collapse the add-forms when the type / category changes (mirrors the sheet's
  // previous inline reset behaviour)
  useEffect(() => setAddingCat(false), [io]);
  useEffect(() => setAddingSubcat(false), [cat]);

  function createCat() {
    const nm = newCatName.trim().replace(/[<>]/g, '').slice(0, 24);
    if (!nm) return;
    const c = addCustomCat(io, nm, newCatEmoji);
    onPickCat(c.k);
    setAddingCat(false);
    setNewCatName('');
  }

  function createSubcat() {
    const nm = newSubcatName.trim().replace(/[<>]/g, '').slice(0, 16);
    if (!nm) return;
    addSubcat(cat, nm);
    setNewSubcatName('');
    setAddingSubcat(false);
  }

  return (
    <>
      <View style={styles.catScroll}>
        <View style={styles.cats}>
          {cats.map((c) => {
            const on = c.k === cat;
            return (
              <Pressable key={c.k} onPress={() => onPickCat(c.k)} style={[styles.catPick, on && { borderColor: t.hibiscus }]}>
                <View style={[styles.catEmo, { backgroundColor: t.card }]}>
                  <Text style={styles.catEmoText}>{c.e}</Text>
                </View>
                <Text style={[styles.catName, { color: on ? t.hibiscus : t.inkSoft }]} numberOfLines={1}>
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
          <EmojiPicker value={newCatEmoji} onPick={setNewCatEmoji} lang={lang} />
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
                onPress={() => onPickSubcat(on ? '' : sc.k)}
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
                onPress={() => onPickAcct(a.id)}
                style={[styles.acctChip, { borderColor: on ? t.hibiscus : t.line, backgroundColor: on ? t.paperWarm : t.card }]}
              >
                <Text style={{ fontSize: 12.5, fontWeight: '600', color: on ? t.hibiscus : t.inkSoft }}>{nm}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  catScroll: { marginBottom: 10 },
  cats: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 4, columnGap: 6 },
  catPick: {
    width: '18.4%', alignItems: 'center', gap: 4, paddingVertical: 7,
    borderRadius: 12, borderWidth: 1.5, borderColor: 'transparent',
  },
  catEmo: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  catEmoAdd: { borderWidth: 1.5, borderStyle: 'dashed' },
  catEmoText: { fontSize: 19 },
  catName: { fontSize: 10.5 },
  catForm: { borderWidth: 1, borderRadius: 13, padding: 12, marginBottom: 12, gap: 10 },
  field: { borderWidth: 1, borderRadius: 11, padding: 11, fontSize: 14 },
  subcatWrap: { marginBottom: 12 },
  subcatChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  subcatForm: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  subcatSave: { borderRadius: 11, paddingVertical: 11, paddingHorizontal: 16, alignItems: 'center' },
  tagChip: { borderWidth: 1, borderRadius: 18, paddingVertical: 6, paddingHorizontal: 12 },
  ledgerChip: { borderStyle: 'dashed' },
  acctRow: { marginBottom: 12 },
  acctChip: { borderWidth: 1.5, borderRadius: 20, paddingVertical: 7, paddingHorizontal: 13, marginRight: 7 },
  save: { flexDirection: 'row', borderRadius: 13, padding: 14, alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4 },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
