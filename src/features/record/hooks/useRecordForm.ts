import { useEffect, useMemo, useState } from 'react';
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
import { store$, addEntry, addTransfer, updateEntry, removeEntry, addTemplate } from '@/store/ledger';
import { noteSuggestions } from '@/domain/notes';
import { NO_ANIM } from '@/util/boot';
import { SPRING } from '@/theme/tokens';
import { parseEntryText } from '@/ai/client';
import { parseReceiptImage, ReceiptError } from '@/ai/receipt';

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
  onSaved: (isNew: boolean, keepOpen?: boolean) => void;
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
  // transient line under the amount: the 再记 confirmation, or the reason a save
  // was rejected (the button used to just do nothing)
  const [flash, setFlash] = useState<{ msg: string; err?: boolean } | null>(null);
  const [aiText, setAiText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState('');
  const [fetchedRate, setFetchedRate] = useState<number | null>(null);
  const [rateSource, setRateSource] = useState<'api' | 'cached' | null>(null);
  const [curDropdown, setCurDropdown] = useState(false);
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);

  // cleared by timer, timer cleared on unmount; errors linger a little longer
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), flash.err ? 2800 : 1600);
    return () => clearTimeout(id);
  }, [flash]);

  // Proactively fetch historical rate when foreign currency or date changes
  useEffect(() => {
    if (cur === base) {
      setFetchedRate(null);
      setRateSource(null);
      return;
    }
    let cancelled = false;
    const dateStr = new Date(ts ?? Date.now()).toISOString().slice(0, 10);
    getRateForDate(base, cur, dateStr, currencies.rates ?? {}).then((rate) => {
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
  }, [cur, ts, base, currencies.rates]);

  // Track if the user has attempted to save (for showing validation errors on inputs)
  const [attempted, setAttempted] = useState(false);

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
      } else if (!draft.amt) {
        setAiMsg(s.aiFailed);
      } else {
        setIO(draft.io);
        setCat(draft.cat);
        setAmt(draft.amt);
        if (draft.note) setNote(draft.note);
        if (draft.date) {
          const [y, m, d] = draft.date.split('-').map(Number);
          setTs(new Date(y, m - 1, d, 12).getTime());
        }
        setAiText('');
      }
    } catch {
      setAiMsg(s.aiFailed);
    } finally {
      setAiBusy(false);
    }
  }

  // Receipt image recognition
  async function handleReceiptCapture(uri: string) {
    setReceiptUri(uri);
    setReceiptBusy(true);
    setFlash(null);
    try {
      const draft = await parseReceiptImage(uri, customCats, lang);
      if (!draft || !draft.amt) {
        setFlash({ msg: s.aiFailed, err: true });
        return;
      }
      setIO(draft.io);
      setCat(draft.cat);
      setAmt(draft.amt);
      if (draft.note) setNote(draft.note);
      if (draft.date) {
        const [y, m, d] = draft.date.split('-').map(Number);
        setTs(new Date(y, m - 1, d, 12).getTime());
      }
    } catch (e) {
      setFlash({ msg: e instanceof ReceiptError ? s.aiFailed : s.cameraPermissionDesc, err: true });
    } finally {
      setReceiptBusy(false);
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
      const dateStr = new Date(ts ?? Date.now()).toISOString().slice(0, 10);
      rate = await getRateForDate(base, cur, dateStr, currencies.rates ?? {});
      if (rate != null) {
        const cached = currencies.rates?.[cur];
        source = cached != null && Math.abs(rate - cached) < 0.000001 ? 'cached' : 'api';
      }
    }

    if (writeEntry(rate ?? undefined) === null) return;
    // Show warning if using cached rate (API failed)
    if (source === 'cached' && cur !== base) {
      setFlash({ msg: s.rateCached, err: true });
      return;
    }
    onSaved(!editId);
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
      const dateStr = new Date(ts ?? Date.now()).toISOString().slice(0, 10);
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
      // Snapshot only the rows removeEntry actually rewrites (the entry, its
      // refund incomes, and the original it refunds) so undo restores those by
      // id. Replaying a whole-array snapshot would also roll back anything
      // added or synced in from another device during the undo window.
      const before = store$.data.peek();
      const target = before.find((x) => x.id === editId);
      const touched = before.filter(
        (x) => x.id === editId || x.refundOf === editId || (!!target?.refundOf && x.id === target.refundOf),
      );
      removeEntry(editId);
      onDeleted?.(() => {
        const byId = new Map(touched.map((e) => [e.id, e] as const));
        store$.data.set(store$.data.peek().map((e) => byId.get(e.id) ?? e));
      });
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
    accounts, entries, tags, currencies, subcats, base, rateCodes,
    // form state
    io, cat, amt, note, acct, acctTo, fee, discount, sheetTags, ledger, cur, subcat, ts,
    flash, aiText, aiBusy, aiMsg, curDropdown, receiptUri, receiptBusy, attempted,
    // animation
    enter,
    // derived
    accent, noteSugg, converted, visibleAccts, visibleLedgers,
    // setters (needed by sub-components for inline handlers)
    setIO, setCat, setAmt, setNote, setAcct, setAcctTo, setFee, setDiscount,
    setSheetTags, setLedger, setCur, setSubcat, setTs, setFlash, setAiText,
    setAiMsg, setCurDropdown, setReceiptUri,
    // handlers
    runAI, handleReceiptCapture, pickIO, onKey, save, saveNext, saveAsTemplate, toggleTag, del,
  };
}
