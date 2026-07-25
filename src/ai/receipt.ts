// Receipt image recognition using MiMo-V2.5 multimodal capability.
// Takes a base64-encoded image and extracts structured transaction data.
import type { Category, IO } from '@/domain/types';
import type { Lang } from '@/i18n';
import { allCats, catName } from '@/domain/cats';
import { normalizeParsed, type EntryDraft, type ParsedEntry } from './parse';

const MIMO_KEY = process.env.EXPO_PUBLIC_MIMO_API_KEY;
const MIMO_URL =
  process.env.EXPO_PUBLIC_MIMO_BASE_URL ||
  (MIMO_KEY?.startsWith('tp-') ? 'https://token-plan-cn.xiaomimimo.com/v1' : 'https://api.xiaomimimo.com/v1');

// MiMo-V2.5 supports multimodal; V2.5-Pro does not.
const RECEIPT_MODEL = 'mimo-v2.5';

const TIMEOUT_MS = 30000; // image processing needs more time

const RECEIPT_SYSTEM = `You are a receipt/bill image reader for a personal finance app.
Analyze the receipt image and extract transaction information.
Return ONLY a compact JSON object with these fields:
- io: "exp" for expense, "inc" for income
- amount: the total amount as a number (no currency symbol)
- category: choose from the provided category list
- note: merchant name or description (keep it short)
- date: ISO date string (YYYY-MM-DD) if visible on the receipt

If you cannot read the image or find no transaction, return {"io":"exp","amount":0,"category":"","note":""}.`;

export function receiptAiConfigured(): boolean {
  return !!MIMO_KEY;
}

export class ReceiptError extends Error {}

/** Convert image URI to base64 string. */
async function imageToBase64(uri: string): Promise<string> {
  try {
    // React Native / Expo: read file as base64
    const FS = await import('expo-file-system');
    const base64 = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
    return base64;
  } catch {
    // Web fallback: fetch and convert
    const res = await fetch(uri);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        resolve(dataUrl.split(',')[1] ?? '');
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

/** Parse receipt image into a transaction draft. */
export async function parseReceiptImage(
  imageUri: string,
  customCats: Record<IO, Category[]>,
  lang: Lang,
): Promise<EntryDraft | null> {
  if (!receiptAiConfigured()) return null;

  const base64 = await imageToBase64(imageUri);
  if (!base64) throw new ReceiptError('image read failed');

  const today = new Date().toISOString().slice(0, 10);
  const expCats = allCats('exp', customCats).map((c) => catName(c, lang)).join('、');
  const incCats = allCats('inc', customCats).map((c) => catName(c, lang)).join('、');

  const system = RECEIPT_SYSTEM + `\n\nToday: ${today}\nExpense categories: ${expCats}\nIncome categories: ${incCats}`;

  let res: Response;
  try {
    res = await fetch(`${MIMO_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MIMO_KEY}` },
      body: JSON.stringify({
        model: RECEIPT_MODEL,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Please read this receipt and extract the transaction details.' },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
            ],
          },
        ],
        temperature: 0,
        max_completion_tokens: 500,
        thinking: { type: 'disabled' },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ReceiptError('network');
  }

  if (!res.ok) throw new ReceiptError(`status ${res.status}`);

  let content = '';
  try {
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    content = json?.choices?.[0]?.message?.content ?? '';
  } catch {
    throw new ReceiptError('bad response');
  }

  let raw: ParsedEntry;
  try {
    // Extract JSON from response (may be wrapped in markdown fences)
    let str = content.trim();
    const fence = str.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) str = fence[1].trim();
    const a = str.indexOf('{');
    const b = str.lastIndexOf('}');
    if (a >= 0 && b > a) str = str.slice(a, b + 1);
    raw = JSON.parse(str) as ParsedEntry;
  } catch {
    throw new ReceiptError('parse failed');
  }

  return normalizeParsed(raw, customCats);
}
