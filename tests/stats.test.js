import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lifetimeValue, windowValue, blend, computeRadar, weakestStats, SATURATION,
  potentialValue, sumStatPoints, TRAINABLE, STATS,
} from '../public/js/game/stats.js';
import { addDays } from '../public/js/game/dates.js';

const NOW = new Date(2026, 6, 11, 12, 0);
const TODAY = '2026-07-11';
const opt = { now: NOW, rolloverHour: 4 };

const c = (date, statPoints, xp = 10) => ({ id: date + JSON.stringify(statPoints), date, xp, statPoints, revoked: false });

test('the registry is exactly 11 stats and Potential is not trainable', () => {
  assert.equal(STATS.length, 11);
  assert.equal(TRAINABLE.length, 10);
  assert.ok(!TRAINABLE.includes('potential'));
});

test('saturation curve: the TRUE anchors for SATURATION = 900', () => {
  // NB: the plan's §5.3 parenthetical ("~2070 → 50, ~4140 → 75") is arithmetically wrong —
  // those numbers describe a constant of ~2986, not 900. These are the real ones.
  assert.ok(Math.abs(lifetimeValue(95) - 10) < 1, '~95 pts → ~10');
  assert.ok(Math.abs(lifetimeValue(624) - 50) < 1, '~624 pts → ~50');
  assert.ok(Math.abs(lifetimeValue(1248) - 75) < 1, '~1248 pts → ~75');
  assert.ok(Math.abs(lifetimeValue(1448) - 80) < 1, '~1448 pts → ~80 (the "year-plus" mark)');
  // Asymptotic in the range that can actually occur. (At absurd inputs the exponential
  // underflows to exactly 0 in float64 and the value lands on a clean 100 — harmless.)
  assert.ok(lifetimeValue(20000) < 100, 'a decade of hard work still has not maxed the axis');
  assert.ok(lifetimeValue(1e9) <= 100, 'and it can never exceed 100');
  assert.equal(SATURATION, 900);
});

test('lifetime value is monotonic — it NEVER decreases', () => {
  let prev = -1;
  for (let p = 0; p < 8000; p += 37) {
    const v = lifetimeValue(p);
    assert.ok(v >= prev, `decreased at ${p}`);
    prev = v;
  }
});

test('window value is floored so week one is not divide-by-tiny noise', () => {
  assert.equal(windowValue(0, 0), 0);
  assert.ok(windowValue(30, 0) <= 100, 'tiny baseline cannot produce >100');
  assert.equal(windowValue(60, 60), 100);
  assert.equal(windowValue(500, 100), 100, 'clamped at 100');
});

test('the blend is 70/30 and the lifetime floor is permanent', () => {
  const life = lifetimeValue(2070);   // ~50
  const idle = blend(life, 0);        // stopped entirely
  assert.ok(Math.abs(idle - 0.7 * life) < 0.001);
  assert.ok(idle > 0, 'neglect sags the axis; it never nukes it');
  assert.ok(idle / life >= 0.7, 'you can lose at most 30% of an axis by going quiet');
});

test('ALL window blends; W/M/Y show the shape of the window', () => {
  const rows = [
    c(TODAY, { health: 20 }),
    c(TODAY, { money: 5 }),
    c(addDays(TODAY, -200), { intelligence: 400 }),  // ancient, big
  ];
  const all = computeRadar(rows, { ...opt, win: 'ALL' });
  const week = computeRadar(rows, { ...opt, win: 'W' });

  const allInt = all.find((a) => a.id === 'intelligence').value;
  const weekInt = week.find((a) => a.id === 'intelligence').value;
  const weekHealth = week.find((a) => a.id === 'health').value;

  assert.ok(allInt > 10, 'lifetime work still shows on the character sheet');
  assert.equal(weekInt, 0, 'but it contributes nothing to this week');
  assert.equal(weekHealth, 100, 'the busiest axis of the window normalizes to 100');
});

test('an axis untouched for 14+ days is marked stale (dimmed, not reduced)', () => {
  const rows = [c(addDays(TODAY, -20), { looks: 50 }), c(TODAY, { health: 10 })];
  const axes = computeRadar(rows, { ...opt, win: 'ALL' });
  assert.equal(axes.find((a) => a.id === 'looks').stale, true);
  assert.equal(axes.find((a) => a.id === 'health').stale, false);
  assert.ok(axes.find((a) => a.id === 'looks').value > 0, 'stale still holds its earned value');
});

test('revoked completions contribute nothing', () => {
  const rows = [{ ...c(TODAY, { health: 100 }), revoked: true }];
  assert.deepEqual(sumStatPoints(rows), {});
  assert.equal(computeRadar(rows, { ...opt, win: 'ALL' }).find((a) => a.id === 'health').value, 0);
});

test('potential is derived from consistency, not from tasks', () => {
  const dead = potentialValue({ journalStreak: 0, logStreak: 0, daysLogged30: 0, milestones30: 0 });
  const alive = potentialValue({ journalStreak: 30, logStreak: 30, daysLogged30: 30, milestones30: 4 });
  assert.equal(dead, 0);
  assert.equal(Math.round(alive), 100);
  assert.ok(potentialValue({ daysLogged30: 15 }) > 0, 'consistency alone moves it');
});

test('potential appears on the radar but never in the quest-eligible weakest set', () => {
  const axes = computeRadar([c(TODAY, { health: 5 })], { ...opt, win: 'ALL' });
  assert.ok(axes.some((a) => a.id === 'potential'));
  assert.ok(!weakestStats(axes, 3).includes('potential'));
});

test('weakestStats returns the three genuinely lowest axes', () => {
  const rows = TRAINABLE.slice(0, 7).map((id, i) => c(TODAY, { [id]: (i + 1) * 100 }));
  const axes = computeRadar(rows, { ...opt, win: 'ALL' });
  const weak = weakestStats(axes, 3);
  assert.equal(weak.length, 3);
  const values = Object.fromEntries(axes.map((a) => [a.id, a.value]));
  const others = TRAINABLE.filter((id) => !weak.includes(id));
  for (const w of weak) {
    for (const o of others) assert.ok(values[w] <= values[o], `${w} should be <= ${o}`);
  }
});

test('empty log yields an all-zero polygon, not NaN', () => {
  for (const a of computeRadar([], { ...opt, win: 'ALL' })) {
    assert.ok(Number.isFinite(a.value), `${a.id} is finite`);
    assert.equal(a.value, 0);
  }
});
