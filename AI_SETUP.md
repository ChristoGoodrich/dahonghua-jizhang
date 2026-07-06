# AI 记账 setup (natural-language quick entry)

Type a sentence like **“午饭35”** or **“coffee 4.5”** in the record sheet and tap ✨ —
Claude extracts the amount, category, income/expense, and a note, and fills the form.

The app **never holds the Anthropic API key**. It calls a small server proxy you
deploy; the proxy calls Claude. When the proxy isn't configured the AI bar is
hidden and the app works exactly as before (fully offline, manual entry).

## 1. Deploy the proxy (Supabase Edge Function)

The reference proxy lives at `supabase/functions/ai-parse/index.ts`. It uses the
official Anthropic SDK and `claude-opus-4-8` with structured outputs, so it returns
strictly-shaped JSON.

```bash
# from dahonghua-app/
supabase functions deploy ai-parse --no-verify-jwt
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   # your key, server-side only
```

The function URL is `https://<project-ref>.supabase.co/functions/v1/ai-parse`.

> Any HTTPS endpoint that accepts `POST {text, lang, categories:{exp[],inc[]}}` and
> returns `{io,amount,category,note}` works — a Cloudflare Worker, a Vercel function,
> your own Node/Deno server. Just keep the API key on the server.

## 2. Point the app at it

In `.env` (see `.env.example`):

```
EXPO_PUBLIC_AI_PROXY_URL=https://<project-ref>.supabase.co/functions/v1/ai-parse
```

Rebuild / restart Expo so the env var is picked up.

## How it works

- `src/ai/parse.ts` — pure prompt building + result normalization (resolves the
  model's category label to one of your category keys; rounds/clamps the amount).
  Fully unit-tested, no network.
- `src/ai/client.ts` — `aiConfigured()` + `parseEntryText()`; no-op returning
  `null` when neither `EXPO_PUBLIC_AI_PROXY_URL` nor `EXPO_PUBLIC_MIMO_API_KEY` is
  set. Proxy takes priority; otherwise it calls MiMo's `/chat/completions` directly.
- `supabase/functions/ai-parse/index.ts` — the reference server-side proxy call.

## Option B — Xiaomi MiMo direct (personal builds only)

Skip the proxy and call Xiaomi **MiMo**'s OpenAI-compatible API straight from the
app. Simplest to set up, but the key is **embedded in the app bundle** and can be
extracted by anyone who installs the build — use this only for a personal app you
run yourself, never a published/store build.

Put the key in **`.env.local`** (gitignored — never `.env` or source):

```
EXPO_PUBLIC_MIMO_API_KEY=sk-...
# optional overrides (defaults shown):
# EXPO_PUBLIC_MIMO_BASE_URL=https://api.xiaomimimo.com/v1
# EXPO_PUBLIC_MIMO_MODEL=mimo-v2.5-pro
```

The MiMo account needs an active balance / token plan — an empty account returns
`402 insufficient_balance`. Get a key + top up at the MiMo console (mimo.mi.com).

## Cost & privacy

Each parse is one short Claude request (a few hundred tokens). Only the sentence you
type and your category names are sent to the proxy; nothing is sent until you tap ✨.
