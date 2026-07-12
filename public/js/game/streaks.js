// streaks.js — streaks, freeze tokens, reboot logic (plan §5.5). Pure.
// Design law: no XP loss, no stat loss, ever. The only currency here is momentum.

import { dayKey, addDays, daysBetween } from './dates.js';

export const TOKEN_EVERY = 7;   // consecutive active days per earned freeze token
export const TOKEN_CAP = 2;
export const REBOOT_THRESHOLD = 3; // missed days that trigger the reboot screen + bonus

/**
 * Replay a set of active days into streak state.
 * activeDays: Set<'YYYY-MM-DD'>. Tokens are only spent on days that are OVER —
 * today is never counted as missed, because it isn't yet.
 *
 * Returns { current, best, tokens, frozenDays:Set, brokenAt, missedBefore }
 *   missedBefore = consecutive missed days immediately before today (drives reboot).
 */
export function computeStreak(activeDays, { now = new Date(), rolloverHour = 4 } = {}) {
  const today = dayKey(now, rolloverHour);
  const days = [...activeDays].sort();
  const empty = { current: 0, best: 0, tokens: 0, frozenDays: new Set(), lastActive: null, missedBefore: 0 };
  if (!days.length) return empty;

  let current = 0, best = 0, tokens = 0, sinceToken = 0, brokenAt = null;
  const frozenDays = new Set();

  for (let k = days[0]; daysBetween(k, today) >= 0; k = addDays(k, 1)) {
    const isToday = k === today;
    if (activeDays.has(k)) {
      current += 1;
      sinceToken += 1;
      if (sinceToken >= TOKEN_EVERY) { tokens = Math.min(TOKEN_CAP, tokens + 1); sinceToken = 0; }
      if (current > best) best = current;
    } else if (isToday) {
      // The day isn't over. Don't judge it, don't spend a token on it.
      continue;
    } else if (tokens > 0) {
      // A freeze token absorbs the miss: streak survives but the day isn't "earned",
      // so it neither increments the count nor advances progress toward the next token.
      tokens -= 1;
      frozenDays.add(k);
    } else {
      if (current > 0) brokenAt = k;
      current = 0;
      sinceToken = 0;
    }
  }

  const lastActive = days[days.length - 1];
  const missedBefore = Math.max(0, daysBetween(lastActive, today) - 1);

  return { current, best, tokens, frozenDays, lastActive, brokenAt, missedBefore };
}

/** The 14-dot strip on the Journal tab. */
export function recentDots(activeDays, frozenDays, { now = new Date(), rolloverHour = 4, n = 14 } = {}) {
  const today = dayKey(now, rolloverHour);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const k = addDays(today, -i);
    const state = activeDays.has(k) ? 'filled'
      : frozenDays.has(k) ? 'frozen'
      : k === today ? 'pending' : 'missed';
    out.push({ day: k, state });
  }
  return out;
}

/** Has the player been away long enough to earn a reboot bonus + the system-reboot screen? */
export function needsReboot(activeDays, { now = new Date(), rolloverHour = 4 } = {}) {
  const { missedBefore, lastActive } = computeStreak(activeDays, { now, rolloverHour });
  const today = dayKey(now, rolloverHour);
  if (!lastActive || activeDays.has(today)) return { reboot: false, missed: 0 };
  return { reboot: missedBefore >= REBOOT_THRESHOLD, missed: missedBefore };
}
