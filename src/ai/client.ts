// AI quick-entry client. Two modes, both optional (app works fully offline when
// neither is set — same gating pattern as src/sync/supabase.ts):
//   1. PROXY  (secure, recommended): EXPO_PUBLIC_AI_PROXY_URL points at a small
//      server that holds the LLM key and returns the parsed JSON.
//   2. MiMo direct: EXPO_PUBLIC_MIMO_API_KEY calls Xiaomi MiMo's OpenAI-compatible
//      API straight from the app. Simplest, but the key ships in the app bundle —
//      fine for a personal build, NOT for a published app. See AI_SETUP.md.
import type { Category, IO } from '@/domain/types';
import type { Lang } from '@/i18n';
import { allCats, catName } from '@/domain/cats';
import { AI_SYSTEM, buildUserPrompt, normalizeParsed, type EntryDraft, type ParsedEntry } from './parse';
import { localDateStr } from '@/domain/dates';

const PROXY = process.env.EXPO_PUBLIC_AI_PROXY_URL;
const MIMO_KEY = process.env.EXPO_PUBLIC_MIMO_API_KEY;
// Token Plan keys (tp-…) use the token-plan cluster; standard keys (sk-…) use the
// pay-as-you-go host. Overridable via EXPO_PUBLIC_MIMO_BASE_URL.
const MIMO_URL =
  process.env.EXPO_PUBLIC_MIMO_BASE_URL ||
  (MIMO_KEY?.startsWith('tp-') ? 'https://token-plan-cn.xiaomimimo.com/v1' : 'https://api.xiaomimimo.com/v1');
const MIMO_MODEL = process.env.EXPO_PUBLIC_MIMO_MODEL || 'mimo-v2.5-pro';

// A hung request would otherwise leave the quick-entry field spinning forever —
// there is no cancel affordance, so the timeout is the only way out.
const TIMEOUT_MS = 20000;

export function aiConfigured(): boolean {
  return !!PROXY || !!MIMO_KEY;
}

/** fetch with a hard deadline; rejects like a network failure on timeout. */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class AIError extends Error {}

/** Pull the JSON object out of a model reply (tolerates code fences / prose). */
function extractJson(s: string): ParsedEntry {
  let str = (s ?? '').trim();
  const fence = str.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) str = fence[1].trim();
  const a = str.indexOf('{');
  const b = str.lastIndexOf('}');
  if (a >= 0 && b > a) str = str.slice(a, b + 1);
  return JSON.parse(str) as ParsedEntry;
}

async function callProxy(text: string, customCats: Record<IO, Category[]>, lang: Lang): Promise<ParsedEntry> {
  const body = {
    text: text.trim(),
    lang,
    categories: {
      exp: allCats('exp', customCats).map((c) => catName(c, lang)),
      inc: allCats('inc', customCats).map((c) => catName(c, lang)),
    },
  };
  let res: Response;
  try {
    res = await fetchWithTimeout(PROXY!, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new AIError('network');
  }
  if (!res.ok) throw new AIError(`status ${res.status}`);
  try {
    return (await res.json()) as ParsedEntry;
  } catch {
    throw new AIError('bad response');
  }
}

async function callMiMo(text: string, customCats: Record<IO, Category[]>, lang: Lang): Promise<ParsedEntry> {
  const today = localDateStr(Date.now());
  const system = AI_SYSTEM.replace('{{today}}', today);
  const messages = [
    { role: 'system', content: `${system} Respond with ONLY a compact JSON object (no markdown, no explanation) of the form {"io","amount","category","note","date"}. The date field is optional (YYYY-MM-DD format, only when user mentions a relative date).` },
    { role: 'user', content: buildUserPrompt(text, customCats, lang) },
  ];
  let res: Response;
  try {
    res = await fetchWithTimeout(`${MIMO_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MIMO_KEY}` },
      // thinking disabled — this is a simple structured extraction, not a reasoning
      // task; leaving it on makes MiMo spend the whole token budget "thinking" and
      // return empty content. Off = ~2s, ~20 tokens, reliable JSON.
      body: JSON.stringify({
        model: MIMO_MODEL,
        messages,
        temperature: 0,
        max_completion_tokens: 300,
        thinking: { type: 'disabled' },
      }),
    });
  } catch {
    throw new AIError('network');
  }
  if (!res.ok) throw new AIError(`status ${res.status}`);
  let content = '';
  try {
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    content = json?.choices?.[0]?.message?.content ?? '';
  } catch {
    throw new AIError('bad response');
  }
  try {
    return extractJson(content);
  } catch {
    throw new AIError('bad response');
  }
}

// Only built-in categories are sent when the user opts out of sharing their
// (potentially sensitive) custom category names — see settings.aiShareCategories.
const NO_CUSTOM_CATS: Record<IO, Category[]> = { exp: [], inc: [], xfer: [] };

/**
 * Parse a natural-language note into a sheet-ready draft.
 * Returns null when AI is not configured (caller falls back gracefully).
 * Throws AIError on network/parse failure so the UI can show a message.
 *
 * `shareCategories` (default true) controls whether the user's custom category
 * names leave the device; the reply is still resolved against the full list
 * locally either way.
 */
export async function parseEntryText(
  text: string,
  customCats: Record<IO, Category[]>,
  lang: Lang,
  shareCategories = true,
): Promise<EntryDraft | null> {
  if (!aiConfigured()) return null;
  const sendCats = shareCategories ? customCats : NO_CUSTOM_CATS;
  const raw = PROXY ? await callProxy(text, sendCats, lang) : await callMiMo(text, sendCats, lang);
  return normalizeParsed(raw, customCats);
}
