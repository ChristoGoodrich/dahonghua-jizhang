import { store$ } from '@/store/ledger';
import { parseEntryText } from '@/ai/client';
import { parseReceiptImage, ReceiptError } from '@/ai/receipt';
import type { Category, IO } from '@/domain/types';
import type { I18N, Lang } from '@/i18n';

interface UseAIEntryDeps {
  aiText: string;
  setAiText: React.Dispatch<React.SetStateAction<string>>;
  setAiBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setAiMsg: React.Dispatch<React.SetStateAction<string>>;
  setIO: React.Dispatch<React.SetStateAction<IO>>;
  setCat: React.Dispatch<React.SetStateAction<string>>;
  setAmt: React.Dispatch<React.SetStateAction<string>>;
  setNote: React.Dispatch<React.SetStateAction<string>>;
  setTs: React.Dispatch<React.SetStateAction<number | null>>;
  setFlash: React.Dispatch<React.SetStateAction<{ msg: string; err?: boolean } | null>>;
  setReceiptUri: React.Dispatch<React.SetStateAction<string | null>>;
  setReceiptBusy: React.Dispatch<React.SetStateAction<boolean>>;
  customCats: Record<IO, Category[]>;
  lang: Lang;
  s: (typeof I18N)[Lang];
}

export function useAIEntry({
  aiText, setAiText, setAiBusy, setAiMsg,
  setIO, setCat, setAmt, setNote, setTs,
  setFlash, setReceiptUri, setReceiptBusy,
  customCats, lang, s,
}: UseAIEntryDeps) {
  async function runAI() {
    const text = aiText.trim();
    if (!text) return;
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

  return { runAI, handleReceiptCapture };
}
