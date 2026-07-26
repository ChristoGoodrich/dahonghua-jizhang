import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { shadow, RAD, TABULAR } from '@/theme/tokens';
import type { Theme } from '@/theme/tokens';
import { evalExpr, hasOperator } from '@/domain/calc';
import { curSymbol } from '@/domain/money';
import type { Strings } from '@/i18n';

interface Props {
  amt: string;
  cur: string;
  base: string;
  accent: string;
  attempted: boolean;
  flash: { msg: string; err?: boolean } | null;
  curDropdown: boolean;
  setCurDropdown: (v: boolean | ((prev: boolean) => boolean)) => void;
  rateCodes: string[];
  setCur: (c: string) => void;
  converted: string | undefined;
  t: Theme;
  s: Strings;
}

export function RecordAmount({
  amt, cur, base, accent, attempted, flash, curDropdown, setCurDropdown,
  rateCodes, setCur, converted, t, s,
}: Props) {
  return (
    <>
      <View style={styles.amtArea}>
        <View style={[styles.amtRow, attempted && flash?.err && { borderWidth: 2, borderColor: t.hibiscus, borderRadius: 8, padding: 4 }]} accessible accessibilityLabel={`${s.amountPh}: ${amt || '0'} ${curSymbol(cur)}`}>
          {/* Currency symbol — subtle background mask when foreign currencies exist */}
          <Pressable
            onPress={() => rateCodes.length > 0 && setCurDropdown((v) => !v)}
            hitSlop={12}
            style={[styles.curWrap, rateCodes.length > 0 && { backgroundColor: t.tint, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }]}
          >
            <Text style={[styles.cur, { color: accent }]}>{curSymbol(cur)}</Text>
          </Pressable>
          <Text
            style={[styles.amtInput, TABULAR, { color: amt ? t.ink : t.line }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {amt || s.amountPh}
          </Text>
        </View>

        {/* Currency dropdown — positioned right below the symbol */}
        {curDropdown && rateCodes.length > 0 && (
          <>
            <Pressable style={styles.curBackdrop} onPress={() => setCurDropdown(false)} />
            <View style={[styles.curDropdown, { backgroundColor: t.card, borderColor: t.line }, shadow(t, 'md')]}>
              {[base, ...rateCodes].map((c) => (
                <Pressable
                  key={c}
                  onPress={() => { setCur(c); setCurDropdown(false); }}
                  style={[styles.curOption, c === cur && { backgroundColor: t.tint }]}
                >
                  <Text style={[styles.curOptionText, { color: c === cur ? t.hibiscus : t.ink }]}>
                    {curSymbol(c)} {c}
                  </Text>
                  {c === cur && <Text style={{ color: t.hibiscus, fontSize: 13 }}>✓</Text>}
                </Pressable>
              ))}
            </View>
          </>
        )}
      </View>
      {/* fixed-height slot: live "=" preview while typing math, or the 再记
          confirmation — constant height so the layout never jumps mid-entry */}
      <View style={styles.subLine}>
        {hasOperator(amt) ? (
          <Text style={[styles.subLineText, TABULAR, { color: t.inkSoft }]}>
            = {curSymbol(cur)}{evalExpr(amt).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </Text>
        ) : flash ? (
          <Text style={[styles.subLineText, { color: flash.err ? t.hibiscus : t.leafDeep }]}>{flash.msg}</Text>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  amtRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 6, marginBottom: 2, paddingHorizontal: 24 },
  amtArea: { position: 'relative', zIndex: 100 },
  cur: { fontSize: 22, fontWeight: '700' },
  curWrap: {},
  curBackdrop: { position: 'absolute', top: 0, left: -100, right: -100, bottom: -200, zIndex: 99 },
  curDropdown: {
    position: 'absolute', top: '100%', left: 0, zIndex: 100,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: RAD.md, paddingVertical: 4,
    minWidth: 130, marginTop: 4,
  },
  curOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 11, paddingHorizontal: 16,
  },
  curOptionText: { fontSize: 15, fontWeight: '600' },
  amtInput: { fontSize: 42, fontWeight: '800', letterSpacing: -0.8, flexShrink: 1, textAlign: 'center', padding: 0 },
  subLine: { minHeight: 18, marginBottom: 4, justifyContent: 'center' },
  subLineText: { fontSize: 11.5, fontWeight: '600', textAlign: 'center' },
});
