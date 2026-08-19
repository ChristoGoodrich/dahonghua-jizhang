import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Flower } from '@/components/Flower';
import { Btn } from '@/components/ui/Btn';
import type { Theme } from '@/theme/tokens';
import type { IO } from '@/domain/types';
import type { Strings } from '@/i18n';

interface Props {
  editId: string | null;
  io: IO;
  onSaveAsTemplate: () => void;
  onSaveNext: () => void;
  onDelete: () => void;
  onSave: () => void;
  t: Theme;
  s: Strings;
}

export function RecordActions({ editId, io, onSaveAsTemplate, onSaveNext, onDelete, onSave, t, s }: Props) {
  return (
    <View style={styles.actions}>
      {!editId && io !== 'xfer' && (
        <Btn label={s.tmplSaveBtn} onPress={onSaveAsTemplate} variant="ghost" style={styles.secondaryBtn} />
      )}
      {!editId && (
        <Btn testID="record-save-next" label={s.saveNext} onPress={onSaveNext} variant="ghost" style={styles.secondaryBtn} />
      )}
      {!!editId && (
        <Btn testID="record-delete" label={s.del} onPress={onDelete} variant="ghost" tone={t.hibiscusDeep} style={styles.secondaryBtn} />
      )}
      <Btn
        testID="record-save"
        label={s.save}
        onPress={onSave}
        gradient={io === 'inc' ? [t.leaf, t.leafDeep] : [t.gradFrom, t.gradTo]}
        leading={<Flower size={20} petal="#fff" stamen="#fff" />}
        style={styles.primaryBtn}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 10, marginTop: 4, alignItems: 'stretch' },
  secondaryBtn: { flex: 1, paddingHorizontal: 6 },
  primaryBtn: { flex: 1.9 },
});
