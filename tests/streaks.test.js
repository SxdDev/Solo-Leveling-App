import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStreak, recentDots, needsReboot } from '../public/js/game/streaks.js';
import { addDays } from '../public/js/game/dates.js';

const NOW = new Date(2026, 6, 11, 12, 0);  // 2026-07-11 noon
const TODAY = '2026-07-11';
const opts = { now: NOW, rolloverHour: 4 };

const daysBack = (n, from = TODAY) => Array.from({ length: n }, (_, i) => addDays(from, -i));

test('an unbroken run counts every day', () => {
  const s = computeStreak(new Set(daysBack(5)), opts);
  assert.equal(s.current, 5);
  assert.equal(s.best, 5);
});

test('7 consecutive days earns exactly one freeze token, capped at 2', () => {
  assert.equal(computeStreak(new Set(daysBack(6)), opts).tokens, 0);
  assert.equal(computeStreak(new Set(daysBack(7)), opts).tokens, 1);
  assert.equal(computeStreak(new Set(daysBack(14)), opts).tokens, 2);
  assert.equal(computeStreak(new Set(daysBack(60)), opts).tokens, 2, 'bank is capped');
});

test('today being empty is NOT a miss — the day is not over', () => {
  const active = new Set(daysBack(5, addDays(TODAY, -1))); // through yesterday only
  const s = computeStreak(active, opts);
  assert.equal(s.current, 5, 'streak stands until today actually ends');
  assert.equal(s.frozenDays.size, 0, 'and no token is spent on it');
});

test('a freeze token absorbs a missed day and the streak survives', () => {
  // 8 days active, then a gap, then today.
  const active = new Set([...daysBack(8, addDays(TODAY, -2)), TODAY]);
  const missed = addDays(TODAY, -1);
  const s = computeStreak(active, opts);
  assert.ok(s.frozenDays.has(missed), 'the gap is frozen, not broken');
  assert.equal(s.current, 9, 'the streak continues through the freeze');
  assert.equal(s.tokens, 0, 'and the token is spent');
});

test('with no tokens banked, a missed day breaks the streak', () => {
  const active = new Set([...daysBack(3, addDays(TODAY, -2)), TODAY]); // only 3 days: no token
  const s = computeStreak(active, opts);
  assert.equal(s.current, 1, 'back to day one');
  assert.equal(s.frozenDays.size, 0);
});

test('best streak is permanent — a break never erases the record', () => {
  const active = new Set([
    ...daysBack(6, addDays(TODAY, -10)), // a 6-day run, long ago
    TODAY,                                // and today
  ]);
  const s = computeStreak(active, opts);
  assert.equal(s.current, 1);
  assert.equal(s.best, 6, 'the record stands');
});

test('no XP or stat concept appears anywhere in streak state', () => {
  const s = computeStreak(new Set(daysBack(3)), opts);
  assert.ok(!('xp' in s), 'streaks never touch XP — punishment mechanics are how habit apps die');
});

test('reboot fires after 3+ missed days, not before', () => {
  const two = new Set(daysBack(4, addDays(TODAY, -3)));
  assert.equal(needsReboot(two, opts).reboot, false, '2 missed days is just a bad patch');

  const four = new Set(daysBack(4, addDays(TODAY, -5)));
  const r = needsReboot(four, opts);
  assert.equal(r.reboot, true);
  assert.equal(r.missed, 4);
});

test('reboot does not fire once you have already logged today', () => {
  const active = new Set([...daysBack(2, addDays(TODAY, -20)), TODAY]);
  assert.equal(needsReboot(active, opts).reboot, false);
});

test('the 14-dot strip labels every day correctly', () => {
  const active = new Set(daysBack(3, addDays(TODAY, -1)));
  const s = computeStreak(active, opts);
  const dots = recentDots(active, s.frozenDays, opts);
  assert.equal(dots.length, 14);
  assert.equal(dots.at(-1).state, 'pending', 'today is pending, never missed');
  assert.equal(dots.at(-2).state, 'filled');
  assert.equal(dots[0].state, 'missed');
});

test('empty history yields a clean zero state, not a crash', () => {
  const s = computeStreak(new Set(), opts);
  assert.deepEqual({ current: s.current, best: s.best, tokens: s.tokens }, { current: 0, best: 0, tokens: 0 });
});
