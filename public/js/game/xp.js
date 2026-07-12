// xp.js — the XP economy. Pure functions only (plan §5.1, §5.2).
// Rebalancing rule (R-4): change constants HERE, and write a journal entry saying why.

export const BASE_XP = [10, 20, 35, 55, 80];        // difficulty 1–5, superlinear
export const DAY_CLEAR_BONUS = 25;                   // all habits + quest done
export const REBOOT_BONUS = 50;                      // first completion back after 3+ missed days
export const MILESTONE_XP = BASE_XP[2];              // a milestone ≈ a difficulty-3 task
export const GOAL_XP_BASE = 250;                     // × horizon multiplier
export const HORIZON_MULT = { milestone: 1, dream: 4 };

// Anti-grind: the same template's yield decays within a day.
// 1st = 100%, 2nd = 50%, 3rd = 25%, 4th+ = 0. Kills the "drink water ×10" exploit
// without a rule the user has to remember.
export const GRIND_DECAY = [1, 0.5, 0.25, 0];

export const baseXp = (difficulty) => BASE_XP[Math.min(5, Math.max(1, difficulty)) - 1];

export const grindMultiplier = (priorToday) =>
  GRIND_DECAY[Math.min(priorToday, GRIND_DECAY.length - 1)];

/** XP a completion is worth right now. Frozen onto the completion row forever. */
export function xpForCompletion(difficulty, priorToday = 0) {
  return Math.round(baseXp(difficulty) * grindMultiplier(priorToday));
}

/**
 * Stat points granted, frozen onto the row.
 * Plan §5.2: baseXP × weight ÷ 10. The grind multiplier is applied here too —
 * otherwise repeat-spamming a task still pumps the radar, which is the same exploit
 * wearing a different hat.
 */
export function statPointsFor(difficulty, statWeights, priorToday = 0) {
  const scale = (baseXp(difficulty) * grindMultiplier(priorToday)) / 10;
  const out = {};
  for (const [statId, w] of Object.entries(statWeights || {})) {
    const pts = +(scale * w).toFixed(3);
    if (pts > 0) out[statId] = pts;
  }
  return out;
}

/** T(L): cumulative XP required to REACH level L. T(1) = 0. */
export function totalXpForLevel(L) {
  if (L <= 1) return 0;
  return Math.round(100 * Math.pow(L - 1, 1.8));
}

/** Invert the curve. Uncapped — 50 is a tuned horizon, not a ceiling. */
export function levelFromXp(totalXp) {
  if (totalXp < 100) return 1;
  let L = Math.max(1, Math.floor(Math.pow(totalXp / 100, 1 / 1.8)) + 1);
  while (totalXpForLevel(L + 1) <= totalXp) L++;
  while (totalXpForLevel(L) > totalXp) L--;
  return L;
}

/** Everything the header XP bar needs. */
export function progress(totalXp) {
  const level = levelFromXp(totalXp);
  const floor = totalXpForLevel(level);
  const ceil = totalXpForLevel(level + 1);
  const into = totalXp - floor;
  const needed = ceil - floor;
  return { level, totalXp, into, needed, ratio: needed ? into / needed : 0 };
}

/** Did this XP gain cross a level boundary? Returns the new level, or 0. */
export function levelCrossed(xpBefore, xpAfter) {
  const a = levelFromXp(xpBefore);
  const b = levelFromXp(xpAfter);
  return b > a ? b : 0;
}
