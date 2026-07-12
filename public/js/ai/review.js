// review.js — the AI client. Two laws:
//   1. The cache (aiReviews, keyed period+periodKey) IS the storage. Generated once, permanent.
//   2. The UI never blocks on AI. Failure is a quiet retry chip, never a spinner gating a tab.

import * as db from '../db.js';
import * as store from '../store.js';
import { build, payloadSize } from './summarizer.js';
import { el, clear, toast } from '../ui/dom.js';
import { haptic } from '../ui/haptics.js';

const ENDPOINT = '/.netlify/functions/review';
const MAX_BODY = 32 * 1024;

const cacheKey = (period, periodKey) => `${period}::${periodKey}`;

export async function getCached(period, periodKey) {
  const rows = await db.all('aiReviews');
  return rows.find((r) => r.period === period && r.periodKey === periodKey) || null;
}

export async function generate(period, periodKey, { force = false } = {}) {
  if (!force) {
    const hit = await getCached(period, periodKey);
    if (hit) return hit;
  }
  if (!navigator.onLine) throw Object.assign(new Error('offline'), { code: 'offline' });

  const summary = await build(period, periodKey);
  const body = { period, periodKey, summary };
  if (payloadSize(body) > MAX_BODY) throw new Error('Payload too large — summarizer needs tightening.');

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sl-device': store.deviceToken() },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    const j = await res.json().catch(() => ({}));
    throw Object.assign(new Error('Daily review quota reached.'), { code: 'quota', resetAt: j.resetAt });
  }
  if (!res.ok) {
    throw Object.assign(new Error(`Review failed (${res.status}).`), { code: 'upstream' });
  }

  const { review, model } = await res.json();
  const existing = await getCached(period, periodKey);
  const row = {
    id: existing?.id || store.uid(),
    period, periodKey,
    summarySent: summary,   // audit trail: exactly what left the device
    text: review,
    model,
    createdAt: new Date().toISOString(),
  };
  await db.put('aiReviews', row);
  return row;
}

const LABEL = { daily: 'Daily debrief', weekly: 'Weekly report', monthly: 'Monthly report', yearly: 'Annual report' };

/** Renders into `host`. Always additive; never throws into the caller's render path. */
export async function renderReviewCard(host, period, periodKey) {
  clear(host);
  const card = el('div', { class: 'panel' });
  const head = el('div', { class: 'panel-title' },
    el('span', { class: 'label' }, LABEL[period]),
    el('span', { class: 'label' }, periodKey));
  card.append(head);
  host.append(card);

  const cached = await getCached(period, periodKey);
  if (cached) {
    card.append(
      el('p', { class: 'review' }, cached.text),
      el('div', { class: 'review-meta' },
        el('span', { class: 'label' }, cached.model),
        el('button', {
          class: 'btn ghost small',
          onClick: () => run(true),
        }, 'Regenerate')),
    );
    return;
  }

  const body = el('div');
  card.append(body);

  const run = async (force = false) => {
    clear(body);
    body.append(el('p', { class: 'pending' }, 'ANALYSING…'));
    try {
      const row = await generate(period, periodKey, { force });
      haptic('tick');
      clear(body);
      body.append(
        el('p', { class: 'review' }, row.text),
        el('div', { class: 'review-meta' },
          el('span', { class: 'label' }, row.model),
          el('button', { class: 'btn ghost small', onClick: () => run(true) }, 'Regenerate')),
      );
    } catch (err) {
      clear(body);
      if (err.code === 'offline') {
        body.append(
          el('p', { class: 'pending' }, 'SYSTEM OFFLINE — review pending.'),
          el('p', { class: 'muted', style: { fontSize: '12px' } }, 'It will generate when you reconnect.'),
        );
        window.addEventListener('online', () => run(force), { once: true });
      } else {
        body.append(
          el('p', { class: 'pending', style: { color: 'var(--warn)' } }, err.message),
          el('button', { class: 'btn ghost small', onClick: () => run(force), style: { marginTop: '8px' } }, 'Retry'),
        );
      }
    }
  };

  // Daily is offered, never auto-fired — it's a debrief, so it should feel like closing the day.
  const isEvening = new Date().getHours() >= 20;
  if (period === 'daily' && !isEvening) {
    body.append(el('p', { class: 'muted', style: { fontSize: '13px' } },
      'Available after 20:00. Close the day first.'));
    body.append(el('button', { class: 'btn ghost small', style: { marginTop: '8px' }, onClick: () => run() }, 'Generate anyway'));
    return;
  }
  body.append(el('button', { class: 'btn primary small', onClick: () => run() }, 'Generate'));
}

export async function usageStats() {
  const rows = await db.all('aiReviews');
  const month = new Date().toISOString().slice(0, 7);
  return {
    thisMonth: rows.filter((r) => r.createdAt?.startsWith(month)).length,
    total: rows.length,
    last: rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0]?.createdAt || null,
  };
}
