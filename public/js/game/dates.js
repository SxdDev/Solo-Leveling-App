// dates.js — pure date math. No DOM, no globals.
// Every "day" in this app is a local calendar day that flips at `rolloverHour`
// (default 04:00), not midnight. A 1 a.m. journal entry belongs to the night before.
// All day keys are 'YYYY-MM-DD' strings in LOCAL time. See plan §10 R-5.

const pad = (n) => String(n).padStart(2, '0');

/** Format a Date as a local YYYY-MM-DD (no UTC anywhere — that's the classic bug). */
export function fmtDay(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The day key a moment belongs to, given the rollover hour. */
export function dayKey(now = new Date(), rolloverHour = 4) {
  const d = new Date(now.getTime());
  d.setHours(d.getHours() - rolloverHour);
  return fmtDay(d);
}

/** Parse 'YYYY-MM-DD' into a local Date at noon (noon avoids all DST edge cases). */
export function parseDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** Shift a day key by n days. DST-safe because parseDay anchors at noon. */
export function addDays(key, n) {
  const d = parseDay(key);
  d.setDate(d.getDate() + n);
  return fmtDay(d);
}

/** Whole days from a → b (b - a). DST-safe. */
export function daysBetween(a, b) {
  return Math.round((parseDay(b) - parseDay(a)) / 86400000);
}

/** Inclusive list of day keys from a to b. */
export function dayRange(a, b) {
  const out = [];
  for (let k = a; daysBetween(k, b) >= 0; k = addDays(k, 1)) out.push(k);
  return out;
}

export function isoWeekKey(key) {
  const d = parseDay(key);
  // ISO: week belongs to the year containing its Thursday.
  const day = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - day + 3);
  const thursdayYear = d.getFullYear();
  const firstThursday = new Date(thursdayYear, 0, 4, 12);
  const fDay = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - fDay + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 86400000));
  return `${thursdayYear}-W${pad(week)}`;
}

export const monthKey = (key) => key.slice(0, 7);
export const yearKey = (key) => key.slice(0, 4);

/** Day keys for the trailing window ending at `key` (inclusive), length n. */
export function trailingWindow(key, n) {
  return dayRange(addDays(key, -(n - 1)), key);
}

/** Start day key for a UI window: 'W' | 'M' | 'Y' | 'ALL'. */
export function windowStart(key, win) {
  if (win === 'W') return addDays(key, -6);
  if (win === 'M') return addDays(key, -29);
  if (win === 'Y') return addDays(key, -364);
  return '0000-01-01';
}
