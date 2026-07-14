// quests.js — daily quest generation (plan §5.4). Pure: same date + same state = same quest.

import { QUEST_POOL } from './questPool.js';
import { TRAINABLE } from './stats.js';
import { baseXp } from './xp.js';
import { addDays } from './dates.js';

export const COOLDOWN_DAYS = 5;
export const WEAK_WEIGHTS = [0.30, 0.20, 0.10]; // 60% of probability mass on the 3 weakest
export const REST_MASS = 0.40;                   // the other 7 stats share this — variety survives

/** Deterministic PRNG. Seed = date string (+ salt for rerolls), so reopening never rerolls. */
export function seededRandom(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return function () {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Difficulty ceiling unlocks with level: L1–7 → ≤2, L8–15 → ≤3, L16–23 → ≤4, L24+ → ≤5.
 *
 * ⚠ PLAN CORRECTION (§5.4). The plan specifies `[1, min(5, 1 + floor(level/8))]`, which at
 * level 1 is the window [1,1] — and most stat pools contain no difficulty-1 quest at all, so
 * a brand-new player's very first quest would fall through the cap entirely. Floor is 2.
 * Level 1 lasts about six hours anyway (you clear it on ~100 XP), so nothing is lost.
 */
export const maxDifficulty = (level) => Math.min(5, 2 + Math.floor(level / 8));

/** Weighted pick over stats: weakest three carry 60%, the rest split 40%. */
export function pickStat(weakest, rand) {
  const weights = {};
  const rest = TRAINABLE.filter((id) => !weakest.includes(id));
  weakest.forEach((id, i) => { weights[id] = WEAK_WEIGHTS[i] ?? 0; });
  rest.forEach((id) => { weights[id] = REST_MASS / Math.max(1, rest.length); });

  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (const [id, w] of Object.entries(weights)) {
    r -= w;
    if (r <= 0) return id;
  }
  return TRAINABLE[0];
}

/**
 * Generate the quest for a day.
 *  weakest        — 3 lowest stat ids (from stats.weakestStats)
 *  level          — for difficulty scaling
 *  recentQuestIds — pool ids offered in the last COOLDOWN_DAYS days
 *  salt           — '' normally; 'r1' for the one allowed reroll
 * Returns null only if literally nothing is eligible (shouldn't happen with a healthy pool).
 */
export function generateQuest({ date, weakest, level = 1, recentQuestIds = [], excludeIds = [], salt = '' }) {
  const rand = seededRandom(date + salt);
  const cap = maxDifficulty(level);
  const blocked = new Set([...recentQuestIds, ...excludeIds]);
  const excluded = new Set(excludeIds);

  const eligibleFor = (statId) => {
    const pool = QUEST_POOL[statId] || [];
    const fresh = pool.filter((q) => !blocked.has(q.id) && q.difficulty <= cap);
    if (fresh.length) return fresh;

    // Nothing fresh within the cap. Break the COOLDOWN before breaking the cap: a repeat is
    // mildly annoying, an over-your-level quest is demoralizing.
    // Cooldowns may bend when a stat has no other suitable content, but an explicit reroll
    // exclusion must not — otherwise the reroll button can hand back the exact same quest.
    const byCap = pool.filter((q) => !excluded.has(q.id) && q.difficulty <= cap);
    if (byCap.length) return byCap;

    // Last resort — this stat has nothing at your level. Hand over its easiest quest, never
    // a random one, so the failure mode is "a bit of a stretch", not "impossible".
    const allowed = pool.filter((q) => !excluded.has(q.id));
    if (!allowed.length) return [];
    const easiest = Math.min(...allowed.map((q) => q.difficulty));
    return allowed.filter((q) => q.difficulty === easiest);
  };

  // Try the weighted pick; if that stat's pool is exhausted, walk the others.
  const order = [pickStat(weakest, rand), ...TRAINABLE];
  for (const statId of order) {
    const pool = eligibleFor(statId);
    if (!pool.length) continue;
    const q = pool[Math.floor(rand() * pool.length)];
    return {
      date,
      questPoolId: q.id,
      statId,
      name: q.name,
      description: q.description,
      difficulty: q.difficulty,
      bonusXp: 2 * baseXp(q.difficulty), // the day's headline
      status: 'offered',
    };
  }
  return null;
}

/** Day keys inside the cooldown window, for collecting recently-offered pool ids. */
export const cooldownWindow = (date) =>
  Array.from({ length: COOLDOWN_DAYS }, (_, i) => addDays(date, -(i + 1)));
