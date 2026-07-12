import test from 'node:test';
import assert from 'node:assert/strict';
import * as XP from '../public/js/game/xp.js';

test('level table matches the plan §5.1', () => {
  const expected = {
    1: 0, 2: 100, 3: 348, 4: 722, 5: 1213, 10: 5220, 20: 20033, 25: 30506, 50: 110243,
  };
  for (const [L, total] of Object.entries(expected)) {
    assert.equal(XP.totalXpForLevel(Number(L)), total, `T(${L})`);
  }
});

test('levelFromXp inverts totalXpForLevel exactly at boundaries', () => {
  for (let L = 1; L <= 80; L++) {
    const t = XP.totalXpForLevel(L);
    assert.equal(XP.levelFromXp(t), L, `at exactly T(${L})`);
    if (L > 1) assert.equal(XP.levelFromXp(t - 1), L - 1, `one XP below T(${L})`);
  }
});

test('levels are uncapped — 50 is a horizon, not a ceiling', () => {
  assert.ok(XP.totalXpForLevel(120) > XP.totalXpForLevel(100));
  assert.equal(XP.levelFromXp(XP.totalXpForLevel(120)), 120);
});

test('level 2 is reachable on day one', () => {
  assert.ok(XP.totalXpForLevel(2) <= 150, 'a realistic 150 XP day should clear level 2');
});

test('a hard task beats spamming trivial ones', () => {
  assert.ok(XP.baseXp(3) > 3 * XP.baseXp(1), 'd3 (35) must beat 3×d1 (30)');
  assert.ok(XP.baseXp(5) > 2 * XP.baseXp(3));
});

test('anti-grind decays repeats within a day to zero', () => {
  const d = 3;
  assert.equal(XP.xpForCompletion(d, 0), 35);
  assert.equal(XP.xpForCompletion(d, 1), 18);  // 50%
  assert.equal(XP.xpForCompletion(d, 2), 9);   // 25%
  assert.equal(XP.xpForCompletion(d, 3), 0);   // 4th+
  assert.equal(XP.xpForCompletion(d, 12), 0);
});

test('stat points follow the same decay — otherwise the radar is exploitable', () => {
  const w = { health: 1.0, discipline: 0.4 };
  const first = XP.statPointsFor(4, w, 0);
  assert.equal(first.health, 5.5);          // 55 × 1.0 / 10
  assert.equal(first.discipline, 2.2);      // 55 × 0.4 / 10

  const fourth = XP.statPointsFor(4, w, 3);
  assert.deepEqual(fourth, {}, 'zeroed repeats grant no stat points at all');
});

test('zero-weight stats are dropped, not stored as 0', () => {
  const pts = XP.statPointsFor(2, { health: 1, looks: 0 }, 0);
  assert.ok(!('looks' in pts));
});

test('levelCrossed only fires on an actual boundary', () => {
  assert.equal(XP.levelCrossed(90, 120), 2);
  assert.equal(XP.levelCrossed(120, 130), 0);
  assert.equal(XP.levelCrossed(0, 400), 3, 'a big jump reports the final level');
});

test('progress never divides by zero and stays in [0,1]', () => {
  for (const xp of [0, 1, 99, 100, 5219, 110243, 999999]) {
    const p = XP.progress(xp);
    assert.ok(p.ratio >= 0 && p.ratio <= 1, `ratio for ${xp}`);
    assert.ok(p.needed > 0);
  }
});
