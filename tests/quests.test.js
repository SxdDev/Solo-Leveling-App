import test from 'node:test';
import assert from 'node:assert/strict';
import { generateQuest, seededRandom, maxDifficulty, pickStat, cooldownWindow } from '../public/js/game/quests.js';
import { QUEST_POOL } from '../public/js/game/questPool.js';
import { TRAINABLE } from '../public/js/game/stats.js';
import { baseXp } from '../public/js/game/xp.js';

const WEAK = ['social', 'money', 'looks'];

test('the pool covers every trainable stat and excludes potential', () => {
  for (const id of TRAINABLE) {
    assert.ok(QUEST_POOL[id]?.length >= 3, `${id} needs a pool`);
  }
  assert.equal(QUEST_POOL.potential, undefined, 'potential is derived — it takes no quests');
});

test('pool entries have stable unique ids (cooldowns depend on it)', () => {
  const ids = Object.values(QUEST_POOL).flat().map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate quest id');
});

test('generation is deterministic — reopening the app never rerolls', () => {
  const args = { date: '2026-07-11', weakest: WEAK, level: 12 };
  const a = generateQuest(args);
  const b = generateQuest(args);
  assert.deepEqual(a, b);
});

test('different days produce different draws', () => {
  const days = ['2026-07-11', '2026-07-12', '2026-07-13', '2026-07-14', '2026-07-15'];
  const picks = days.map((date) => generateQuest({ date, weakest: WEAK, level: 20 }).questPoolId);
  assert.ok(new Set(picks).size > 1, 'the seed must actually vary by date');
});

test('difficulty ceiling unlocks with level', () => {
  // Floor of 2, not 1: a literal [1,1] window (the plan's formula) leaves most stat pools with
  // NO eligible quest on day one, and level 1 lasts about six hours anyway.
  assert.equal(maxDifficulty(1), 2);
  assert.equal(maxDifficulty(8), 3);
  assert.equal(maxDifficulty(16), 4);
  assert.equal(maxDifficulty(24), 5);
  assert.equal(maxDifficulty(99), 5, 'capped at 5');
});

test('every stat pool can satisfy a level-1 player', () => {
  for (const id of TRAINABLE) {
    const easiest = Math.min(...QUEST_POOL[id].map((q) => q.difficulty));
    assert.ok(easiest <= maxDifficulty(1), `${id} has nothing a level-1 player can be given`);
  }
});

test('a level-1 player is never handed a hard quest', () => {
  for (let d = 1; d <= 40; d++) {
    const q = generateQuest({ date: `2026-08-${String(d).padStart(2, '0')}`, weakest: WEAK, level: 1 });
    assert.ok(q.difficulty <= maxDifficulty(1), `day ${d} handed a d${q.difficulty} quest at level 1`);
  }
});

test('bonus XP is 2× base — the quest is the day\'s headline', () => {
  const q = generateQuest({ date: '2026-07-11', weakest: WEAK, level: 30 });
  assert.equal(q.bonusXp, 2 * baseXp(q.difficulty));
});

test('weighting favours the weak 3 (~60%) but variety survives (~40%)', () => {
  let weak = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const rand = seededRandom(`sample-${i}`);
    if (WEAK.includes(pickStat(WEAK, rand))) weak++;
  }
  const share = weak / N;
  assert.ok(share > 0.53 && share < 0.67, `weak-stat share was ${share.toFixed(3)}, expected ~0.60`);
});

test('the weakest stat is favoured but never a daily treadmill', () => {
  const stats = new Set();
  for (let d = 1; d <= 28; d++) {
    const q = generateQuest({ date: `2026-09-${String(d).padStart(2, '0')}`, weakest: WEAK, level: 40 });
    stats.add(q.statId);
  }
  assert.ok(stats.size >= 3, 'a month of quests must not hammer one hated stat every day');
});

test('cooldown keeps a quest off the board for 5 days', () => {
  const win = cooldownWindow('2026-07-11');
  assert.deepEqual(win, ['2026-07-10', '2026-07-09', '2026-07-08', '2026-07-07', '2026-07-06']);

  const recent = QUEST_POOL.social.map((q) => q.id);
  const q = generateQuest({ date: '2026-07-11', weakest: ['social', 'money', 'looks'], level: 40, recentQuestIds: recent });
  assert.ok(q, 'must still produce a quest');
  // If social is fully cooled down, it should draw from another stat rather than repeat.
  if (q.statId === 'social') assert.ok(!recent.includes(q.questPoolId));
});

test('reroll produces a different quest from the same day', () => {
  const first = generateQuest({ date: '2026-07-11', weakest: WEAK, level: 30 });
  const second = generateQuest({ date: '2026-07-11', weakest: WEAK, level: 30, excludeIds: [first.questPoolId], salt: 'reroll' });
  assert.notEqual(second.questPoolId, first.questPoolId);
});

test('generation never returns null with a healthy pool', () => {
  for (let d = 1; d <= 31; d++) {
    const q = generateQuest({ date: `2026-10-${String(d).padStart(2, '0')}`, weakest: WEAK, level: 5 });
    assert.ok(q && q.name && q.statId, `no quest on day ${d}`);
  }
});
