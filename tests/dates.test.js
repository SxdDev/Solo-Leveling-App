import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, addDays, daysBetween, dayRange, isoWeekKey, trailingWindow, windowStart } from '../public/js/game/dates.js';

// R-5: rollover hour + ISO weeks + DST is where trackers go to die. These are the tests
// that make streaks trustworthy. Run with TZ=America/New_York to exercise DST properly.

test('rollover: 1am belongs to the night before', () => {
  const oneAm = new Date(2026, 6, 11, 1, 30);
  assert.equal(dayKey(oneAm, 4), '2026-07-10');
});

test('rollover: 4am exactly starts the new day', () => {
  assert.equal(dayKey(new Date(2026, 6, 11, 4, 0), 4), '2026-07-11');
  assert.equal(dayKey(new Date(2026, 6, 11, 3, 59), 4), '2026-07-10');
});

test('rollover hour 0 behaves like plain midnight', () => {
  assert.equal(dayKey(new Date(2026, 6, 11, 0, 30), 0), '2026-07-11');
});

test('addDays crosses the spring-forward boundary (US DST 2026-03-08)', () => {
  assert.equal(addDays('2026-03-07', 1), '2026-03-08');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2);
});

test('addDays crosses the fall-back boundary (US DST 2026-11-01)', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-11-01', 1), '2026-11-02');
  assert.equal(daysBetween('2026-10-31', '2026-11-02'), 2);
});

test('a 30-day window across DST is exactly 30 days', () => {
  assert.equal(trailingWindow('2026-03-20', 30).length, 30);
  assert.equal(trailingWindow('2026-11-10', 30).length, 30);
  assert.equal(new Set(trailingWindow('2026-03-20', 30)).size, 30, 'no duplicate days');
});

test('month and year boundaries', () => {
  assert.equal(addDays('2025-12-31', 1), '2026-01-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29', 'leap year');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01', 'non-leap year');
});

test('ISO weeks: the year-boundary trap', () => {
  assert.equal(isoWeekKey('2026-01-01'), '2026-W01');
  assert.equal(isoWeekKey('2025-12-29'), '2026-W01', 'a Monday in December can belong to next ISO year');
  assert.equal(isoWeekKey('2026-07-11'), '2026-W28');
});

test('a week is 7 days and Mon–Sun stays one week key', () => {
  const week = dayRange('2026-07-06', '2026-07-12'); // Mon–Sun
  assert.equal(week.length, 7);
  assert.equal(new Set(week.map(isoWeekKey)).size, 1);
});

test('windowStart spans are inclusive of today', () => {
  assert.equal(dayRange(windowStart('2026-07-11', 'W'), '2026-07-11').length, 7);
  assert.equal(dayRange(windowStart('2026-07-11', 'M'), '2026-07-11').length, 30);
});
