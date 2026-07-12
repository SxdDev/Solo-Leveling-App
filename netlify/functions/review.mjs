// review.mjs — the only server code in this repo.
//
// THE PROBLEM, STATED PLAINLY (§6.5 / R-3): this site has no login, so this URL is publicly
// callable by anyone who finds it. Nothing key-less can stop a determined attacker. What the
// four layers below CAN do is cap the damage at pocket change:
//
//   1. Origin/Referer allowlist  — stops drive-by browser abuse. Trivially spoofed by curl.
//   2. Per-device daily quota    — a stranger can mint UUIDs, so it isn't sufficient alone.
//   3. Global daily cap          — the blast-radius limiter. This is the one that matters.
//   4. Hard spend cap in the Anthropic console — SET THIS BEFORE YOU DEPLOY. Not optional.
//
// Also: this function never logs request bodies. Journal excerpts can pass through here.

import { getStore } from '@netlify/blobs';

const MODEL_DAILY = 'claude-haiku-4-5-20251001';
const MODEL_LONG = 'claude-sonnet-4-6';

const PER_DEVICE_DAILY = 8;
const GLOBAL_DAILY = 40;
const MAX_BODY = 32 * 1024;
const TIMEOUT_MS = 20_000; // Netlify's sync limit is 26 s — stay under it.

const SYSTEM_PROMPT = `You are the System — the analytical intelligence inside a personal RPG-style
life tracker. You review the player's real logged data and report on it.

Voice: direct, precise, observant. Second person. You may use light system/
RPG framing ("Health is your most-fed stat this week") but you are not a
character and you do not roleplay beyond tone. No emoji.

Rules:
1. Ground every claim in the data provided. Never invent activities,
   numbers, or trends that are not in the payload. If data is thin, say so.
2. Do not praise by default. Acknowledge genuine wins in one line, specific
   and earned ("9 workouts in 7 days is your best week on record"), then move on.
3. Name avoidance plainly. If a stat got zero input, or a habit's completion
   rate is sliding, or journaling stopped, state it and its trajectory.
   You are honest, not cruel: describe the pattern, not the person.
4. Exactly one recommendation per review — the highest-leverage one. Not a list.
5. Never moralize about rest days, food, or missed days beyond the data.
   You report patterns; you do not shame.
6. Length: daily <= 120 words. weekly <= 250. monthly/yearly <= 400.
7. Format: 2-4 short paragraphs, plain text. Open with the single most
   important observation of the period — never with a greeting.`;

const MAX_TOKENS = { daily: 500, weekly: 900, monthly: 900, yearly: 900 };
const PERIODS = ['daily', 'weekly', 'monthly', 'yearly'];

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const todayKey = () => new Date().toISOString().slice(0, 10);

/** Returns true if allowed; increments the counter. */
async function checkQuota(store, key, limit) {
  const day = todayKey();
  const id = `${key}:${day}`;
  const current = Number((await store.get(id)) || 0);
  if (current >= limit) return { ok: false, used: current };
  await store.set(id, String(current + 1));
  return { ok: true, used: current + 1 };
}

export default async function handler(req, context) {
  if (req.method !== 'POST') return json(405, { error: 'POST only.' });

  // ---- Layer 1: origin allowlist -------------------------------------------------
  const allowed = (process.env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get('origin') || req.headers.get('referer') || '';
  if (allowed.length && !allowed.some((a) => origin.startsWith(a))) {
    return json(403, { error: 'Origin not allowed.' });
  }

  // ---- Body validation -----------------------------------------------------------
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(400, { error: 'Payload too large.' });

  let body;
  try { body = JSON.parse(raw); } catch { return json(400, { error: 'Malformed JSON.' }); }

  const { period, periodKey, summary } = body || {};
  if (!PERIODS.includes(period)) return json(400, { error: 'Unknown period.' });
  if (typeof periodKey !== 'string' || periodKey.length > 32) return json(400, { error: 'Bad periodKey.' });
  if (!summary || typeof summary !== 'object') return json(400, { error: 'Missing summary.' });

  const device = req.headers.get('x-sl-device') || '';
  if (!/^[0-9a-f-]{8,40}$/i.test(device)) return json(401, { error: 'Missing device token.' });

  // ---- Layers 2 & 3: quotas ------------------------------------------------------
  try {
    const store = getStore('sl-quota');
    const global = await checkQuota(store, 'global', GLOBAL_DAILY);
    if (!global.ok) {
      return json(429, { error: 'Site-wide daily cap reached.', resetAt: `${todayKey()}T23:59:59Z` });
    }
    const dev = await checkQuota(store, `dev:${device}`, PER_DEVICE_DAILY);
    if (!dev.ok) {
      return json(429, { error: 'Daily review quota reached.', resetAt: `${todayKey()}T23:59:59Z` });
    }
  } catch (err) {
    // Blobs unavailable (e.g. netlify dev without linking). Fail OPEN in dev, CLOSED in prod:
    // an unmetered public endpoint in production is exactly the R-3 scenario.
    if (process.env.CONTEXT === 'production') {
      return json(503, { error: 'Quota store unavailable.' });
    }
  }

  // ---- Layer 4 lives in the Anthropic console. Go set it. -------------------------
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json(503, { error: 'Reviewer not configured.' });

  const model = period === 'daily' ? MODEL_DAILY : MODEL_LONG;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS[period],
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Review this ${period} period (${periodKey}). Data follows as JSON.\n\n${JSON.stringify(summary)}`,
        }],
      }),
    });

    if (!res.ok) {
      // Deliberately does NOT echo the upstream body — it can contain the payload.
      return json(502, { error: `Upstream error (${res.status}).` });
    }

    const data = await res.json();
    const review = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (!review) return json(502, { error: 'Empty review returned.' });
    return json(200, { review, model });
  } catch (err) {
    if (err.name === 'AbortError') return json(504, { error: 'Reviewer timed out.' });
    return json(502, { error: 'Reviewer unreachable.' });
  } finally {
    clearTimeout(timer);
  }
}
