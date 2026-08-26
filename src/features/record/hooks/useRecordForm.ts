import { useEffect, useMemo } from 'react';
import { Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAnimatedValue } from '@/hooks/useAnimatedValue';
import { useTheme } from '@/theme/ThemeContext';
import { allCats, catName, catOf } from '@/domain/cats';
import { toBase, curSymbol } from '@/domain/money';
import { getRateForDate } from '@/domain/rates';
import { evalExpr, applyKey } from '@/domain/calc';
import { pickerAccounts, pickerLedgers } from '@/domain/archive';
import type { Category, IO } from '@/domain/types';
import type { Lang } from '@/i18n';
import { I18N } from '@/i18n';
import { store$, addEntry, addTransfer, updateEntry, removeEntry, unremoveEntry, addTemplate } from '@/store/ledger';
import { noteSuggestions } from '@/domain/notes';
import { NO_ANIM } from '@/util/boot';
import { SPRING } from '@/theme/tokens';
import { useFormState } from './useFormState';
import { useAIEntry } from './useAIEntry';
import { localDateStr } from '@/domain/dates';

export interface RecordFormProps {
  visible: boolean;
  editId: string | null;
  /** Pre-picked date for a NEW entry (e.g. calendar 补记这天); null = now. */
  initialTs?: number | null;
  /** Copy an existing entry's fields into a NEW entry (再记一笔). Ignored when editId is set. */
  dupeId?: string | null;
  lang: Lang;
  customCats: Record<IO, Category[]>;
  onClose: () => void;
  /** `warn` carries a notice about the entry that was just saved — a stale
   *  exchange rate — which has to outlive the sheet that is closing. */
  onSaved: (isNew: boolean, keepOpen?: boolean, warn?: string) => void;
  onTemplateSaved?: () => void;
  onDeleted?: (restore: () => void) => void;
}

export function useRecordForm({ visible, editId, initialTs, dupeId, lang, customCats, onClose, onSaved, onTemplateSaved, onDeleted }: RecordFormProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const s = I18N[lang];
  const accounts = store$.accounts.get();
  const entries = store$.data.get();
  const tags = store$.tags.get();
  const currencies = store$.currencies.get();
  const subcats = store$.subcats.get();
  const base = currencies.base || 'CNY';
  const rateCodes = Object.keys(currencies.rates || {});

  const state = useFormState(base);
  const {
    io, cat, amt, note, acct, acctTo, fee, discount, sheetTags, ledger, cur, subcat,
    ts, flash, aiText, aiBusy, aiMsg, fetchedRate, rateSource, curDropdown,
    receiptUri, receiptBusy, attempted, initKey,
    setIO, setCat, setAmt, setNote, setAcct, setAcctTo, setFee, setDiscount,
    setSheetTags, setLedger, setCur, setSubcat, setTs, setFlash, setAiText,
    setAiBusy, setAiMsg, setFetchedRate, setRateSource, setCurDropdown,
    setReceiptUri, setReceiptBusy, setAttempted, setInitKey,
  } = state;

  const { runAI, handleReceiptCapture } = useAIEntry({
    aiText, setAiText, setAiBusy, setAiMsg,
    setIO, setCat, setAmt, setNote, setTs,
    setFlash, setReceiptUri, setReceiptBusy,
    customCats, lang, s,
  });

  // cleared by timer, timer cleared on unmount; errors linger a little longer
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), flash.err ? 2800 : 1600);
    return () => clearTimeout(id);
  }, [flash, setFlash]);

  // Proactively fetch historical rate when foreign currency or date changes
  useEffect(() => {
    let cancelled = false;

    const ratePromise = cur === base
      ? Promise.resolve(null)
      : (() => {
          const dateStr = localDateStr(ts ?? Date.now());
          return getRateForDate(base, cur, dateStr, currencies.rates ?? {});
        })();

    ratePromise.then((rate) => {
      if (cancelled) return;
      if (rate != null) {
        setFetchedRate(rate);
        const cached = currencies.rates?.[cur];
        setRateSource(cached != null && Math.abs(rate - cached) < 0.000001 ? 'cached' : 'api');
      } else {
        setFetchedRate(null);
        setRateSource(null);
      }
    });

    return () => { cancelled = true; };
  }, [cur, ts, base, currencies.rates, setFetchedRate, setRateSource]);

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

  // Re-initialize the form whenever the sheet opens or switches target entry.
  // Adjusted during render (guarded by initKey) rather than in an effect, so
  // the first visible frame already shows the right values — and creating a
  // category mid-entry no longer wipes the half-typed form.
  // dupeId encodes into the key so opening a duplicate re-inits even though it's
  // a NEW entry (editId null); a plain new-entry open uses ''.
  const formKey = visible ? (editId ?? (dupeId ? 'd' + dupeId : '')) : null;
  if (initKey !== formKey) {
    setInitKey(formKey);
    if (formKey !== null) {
      setAiText('');
      setAiMsg('');
      setReceiptUri(null);
      setReceiptBusy(false);
      const baseNow = store$.currencies.base.peek() || 'CNY';
      // edit loads the target; duplicate copies a source entry's fields into a
      // fresh entry (editId stays null → saves via addEntry, dated today)
      const srcId = editId ?? dupeId ?? null;
      const d = srcId ? store$.data.peek().find((x) => x.id === srcId) : undefined;
      setFlash(null);
      setAttempted(false);
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

  /** Why this form can't be saved yet, or null when it's good to go. Every
   *  rejection needs a message: the save button used to silently do nothing on
   *  a zero amount or an incomplete transfer, which reads as a broken button. */
  function validationError(): string | null {
    const value = evalExpr(amt);
    if (!value || value <= 0) return s.errAmount;
    if (io === 'xfer') {
      if (!acctTo) return s.errXferTo;
      if (acct === acctTo) return s.errXferSame;
    }
    if (cur !== base && !currencies.rates?.[cur]) return s.errNoRate.replace('%s', cur);
    return null;
  }

  // Write the entry (add or update). Returns the amount as typed (in the
  // entry's own currency) for feedback, or null when the form isn't saveable.
  function writeEntry(rateOverride?: number): number | null {
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

    const foreign = cur && cur !== base;
    const effectiveRate = rateOverride ?? (foreign ? currencies.rates?.[cur] : undefined);
    const storeAmt = toBase(value, cur, currencies, effectiveRate); // always persist in base currency
    const extra = {
      tags: sheetTags.length ? sheetTags : undefined,
      ledger: ledger || undefined,
      subcat: subcat || undefined,
      cur: foreign ? cur : undefined,
      origAmt: foreign ? value : undefined,
      rate: foreign ? effectiveRate : undefined,
    };
    if (editId) {
      updateEntry(editId, { io, cat, amt: storeAmt, note: trimmed, acct, ...extra, ...tsPatch });
    } else {
      addEntry({ io, cat, amt: storeAmt, note: trimmed, acct, ...extra, ts: ts ?? undefined });
    }
    return value;
  }

  async function save() {
    const err = validationError();
    if (err) {
      setFlash({ msg: err, err: true });
      setAttempted(true);
      return;
    }

    let rate = fetchedRate;
    let source = rateSource;
    // Fetch rate on demand if foreign currency and proactive fetch hasn't run yet
    if (cur !== base && rate == null) {
      const dateStr = localDateStr(ts ?? Date.now());
      rate = await getRateForDate(base, cur, dateStr, currencies.rates ?? {});
      if (rate != null) {
        const cached = currencies.rates?.[cur];
        source = cached != null && Math.abs(rate - cached) < 0.000001 ? 'cached' : 'api';
      }
    }

    if (writeEntry(rate ?? undefined) === null) return;
    // A stale rate is a warning ABOUT a saved entry, not a failed save. It used
    // to flash as an error and return — skipping onClose, so the sheet stayed
    // open over an entry that was already written, and a second press wrote a
    // second one. The notice goes to the caller instead, which has a toast that
    // outlives the sheet.
    const warn = source === 'cached' && cur !== base ? s.rateCached : undefined;
    if (warn) onSaved(!editId, false, warn);
    else onSaved(!editId);
    onClose();
  }

  // 再记 — save and keep the sheet open for the next entry of the same kind:
  // io/category/account/currency/date/tags/ledger stay, amount+note+subcat clear.
  async function saveNext() {
    const err = validationError();
    if (err) {
      setFlash({ msg: err, err: true });
      return;
    }

    let rate = fetchedRate;
    let source = rateSource;
    // Fetch rate on demand if foreign currency and proactive fetch hasn't run yet
    if (cur !== base && rate == null) {
      const dateStr = localDateStr(ts ?? Date.now());
      rate = await getRateForDate(base, cur, dateStr, currencies.rates ?? {});
      if (rate != null) {
        const cached = currencies.rates?.[cur];
        source = cached != null && Math.abs(rate - cached) < 0.000001 ? 'cached' : 'api';
      }
    }

    const value = writeEntry(rate ?? undefined);
    if (value === null) return;
    onSaved(true, true);
    setAmt('');
    setNote('');
    setSubcat('');
    setFee('');
    setDiscount('');
    const msg = s.savedNext.replace('%s', curSymbol(cur) + value.toFixed(2));
    setFlash({ msg: cur !== base && source === 'cached' ? msg + ' · ' + s.rateCached : msg });
  }

  function saveAsTemplate() {
    const value = evalExpr(amt);
    if (!value || value <= 0) {
      setFlash({ msg: s.errAmount, err: true });
      return;
    }
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
      // undo goes through unremoveEntry — a fresh stamped write, not a replay
      // of the old rows, so the restore survives a sync round-trip (state.ts)
      const undo = removeEntry(editId);
      if (undo) onDeleted?.(() => unremoveEntry(undo));
    }
    onClose();
  }

  const accent = io === 'inc' ? t.leaf : t.hibiscus;
  // auto-learned note chips for the selected category (frequency + recency).
  // Memoized: this scans the entire ledger, and it used to re-run on every
  // render — i.e. on every keypress of the amount keypad.
  const noteSugg = useMemo(
    () => (io === 'xfer' || !visible ? [] : noteSuggestions(entries, io, cat)),
    [entries, io, cat, visible],
  );
  const converted =
    cur !== base && !!evalExpr(amt)
      ? s.curConverted.replace('%s', curSymbol(base) + toBase(evalExpr(amt), cur, currencies, fetchedRate ?? undefined).toFixed(2))
      : undefined;

  return {
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
    // setters (needed by sub-components for inline handlers)
    setCat, setNote, setAcct, setAcctTo, setFee, setDiscount,
    setLedger, setCur, setSubcat, setTs, setAiText, setCurDropdown, setReceiptUri,
    // handlers
    runAI, handleReceiptCapture, pickIO, onKey, save, saveNext, saveAsTemplate, toggleTag, del,
  };
}
