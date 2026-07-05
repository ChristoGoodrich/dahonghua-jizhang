import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Chip } from '@/components/ui/Chip';
import { Tap } from '@/components/ui/Tap';
import { RAD } from '@/theme/tokens';
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
              <Tap
                key={c.k}
                onPress={() => onPickCat(c.k)}
                scaleTo={0.9}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={catName(c, lang)}
                style={[styles.catPick, on && { borderColor: t.hibiscus, backgroundColor: t.tint }]}
              >
                <View style={[styles.catEmo, { backgroundColor: on ? 'transparent' : t.card }]}>
                  <Text style={styles.catEmoText}>{c.e}</Text>
                </View>
                <Text style={[styles.catName, { color: on ? t.hibiscus : t.inkSoft }, on && styles.catNameOn]} numberOfLines={1}>
                  {catName(c, lang)}
                </Text>
              </Tap>
            );
          })}
          <Tap style={styles.catPick} scaleTo={0.9} onPress={() => setAddingCat((v) => !v)} accessibilityRole="button" accessibilityLabel={s.newCat}>
            <View style={[styles.catEmo, styles.catEmoAdd, { backgroundColor: t.paperWarm, borderColor: t.line }]}>
              <Text style={[styles.catEmoText, { color: t.inkSoft }]}>＋</Text>
            </View>
            <Text style={[styles.catName, { color: t.inkSoft }]}>{s.newCat}</Text>
          </Tap>
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
              <Chip
                key={sc.k}
                label={sc.name}
                on={on}
                onPress={() => onPickSubcat(on ? '' : sc.k)}
                onLongPress={() => removeSubcat(cat, sc.k)}
              />
            );
          })}
          <Chip label={s.subcatAdd} dashed onPress={() => setAddingSubcat((v) => !v)} />
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
          <View style={styles.acctInner}>
            {accounts.map((a) => {
              const nm = lang === 'zh' ? a.name : a.nameEn || a.name;
              return <Chip key={a.id} label={nm} on={a.id === acct} onPress={() => onPickAcct(a.id)} />;
            })}
          </View>
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
    borderRadius: RAD.sm, borderWidth: 1.2, borderColor: 'transparent',
  },
  catEmo: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  catEmoAdd: { borderWidth: 1.2, borderStyle: 'dashed' },
  catEmoText: { fontSize: 19 },
  catName: { fontSize: 10.5 },
  catNameOn: { fontWeight: '700' },
  catForm: { borderWidth: 1, borderRadius: RAD.sm, padding: 12, marginBottom: 12, gap: 10 },
  field: { borderWidth: StyleSheet.hairlineWidth, borderRadius: RAD.xs, padding: 11, fontSize: 14 },
  subcatWrap: { marginBottom: 12 },
  subcatChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  subcatForm: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  subcatSave: { borderRadius: RAD.xs, paddingVertical: 11, paddingHorizontal: 16, alignItems: 'center' },
  acctRow: { marginBottom: 12 },
  acctInner: { flexDirection: 'row', gap: 7, paddingVertical: 2 },
  save: { flexDirection: 'row', borderRadius: RAD.sm, padding: 14, alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4 },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
