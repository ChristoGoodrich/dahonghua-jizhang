// Supabase Edge Function (Deno): natural-language → structured transaction.
// This is where the Anthropic call lives — server-side, so ANTHROPIC_API_KEY
// never ships in the mobile bundle. The app calls this via EXPO_PUBLIC_AI_PROXY_URL.
//
// Deploy:  supabase functions deploy ai-parse --no-verify-jwt
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// See AI_SETUP.md.
import Anthropic from 'npm:@anthropic-ai/sdk@^0.70';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    io: { type: 'string', enum: ['exp', 'inc'] },
    amount: { type: 'number' },
    category: { type: 'string' },
    note: { type: 'string' },
    date: { type: 'string', description: 'ISO date (YYYY-MM-DD) when user mentions a relative date' },
  },
  required: ['io', 'amount', 'category'],
  additionalProperties: false,
};

const SYSTEM =
  'You extract a single personal-finance transaction from a short note. ' +
  'Return only the structured fields. io is "exp" for money spent and "inc" for money received. ' +
  'amount is a positive number in the main currency (no symbol). ' +
  'category MUST be chosen from the provided category list (use the exact label). ' +
  'note is a short free-text memo (the merchant or what it was for), omit if there is nothing extra. ' +
  'If the user mentions a relative date (e.g. "昨天", "前天", "上周三", "last Friday", "3天前"), ' +
  'return date as an ISO date string (YYYY-MM-DD) based on today being {{today}}. ' +
  'Omit date if no date is mentioned (the entry will use the current time).';

const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { text, categories } = await req.json();
    if (!text || typeof text !== 'string') {
      return json({ error: 'missing text' }, 400);
    }
    const exp = (categories?.exp ?? []).join('、');
    const inc = (categories?.inc ?? []).join('、');
    const prompt =
      `支出分类 / expense categories: ${exp}\n` +
      `收入分类 / income categories: ${inc}\n\n` +
      `记一笔 / entry: ${text}`;

    const today = new Date().toISOString().slice(0, 10);
    const system = SYSTEM.replace('{{today}}', today);

    const resp = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      system,
      output_config: { format: { type: 'json_schema', schema: RESULT_SCHEMA } },
      messages: [{ role: 'user', content: prompt }],
    });

    if (resp.stop_reason === 'refusal') return json({ error: 'refused' }, 422);
    const block = resp.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') return json({ error: 'no output' }, 502);
    // output_config.format guarantees the text block is valid JSON matching the schema.
    return new Response(block.text, { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
