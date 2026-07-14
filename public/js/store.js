// store.js — the only module that writes to the database.
// Core principle (plan §3): the `completions` log is append-only and is the SINGLE SOURCE OF
// TRUTH. Level, stats, streaks are DERIVED, cached in sl.derived for speed, and always
// reproducible by replaying the log. If the number looks wrong, recomputeDerived() fixes it.

import * as db from './db.js';
import { emit } from './bus.js';
import { dayKey, addDays, daysBetween, trailingWindow, isoWeekKey, monthKey } from './game/dates.js';
import * as XP from './game/xp.js';
import { computeRadar, weakestStats, TRAINABLE } from './game/stats.js';
import { computeStreak, needsReboot } from './game/streaks.js';
import { generateQuest, cooldownWindow } from './game/quests.js';
import {
  availableRoutines, easternClock, routineAwardTemplateId, routineById, routineStepTemplateId,
} from './game/routines.js';

const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'x'.replace(/x/, () => Date.now().toString(36) + Math.random().toString(36).slice(2)));
const nowIso = () => new Date().toISOString();

/* ---------- localStorage: small, hot, boot-critical only ---------- */

const LS = {
  profile: 'sl.profile',
  settings: 'sl.settings',
  derived: 'sl.derived',
  lastOpenDate: 'sl.lastOpenDate',
  deviceToken: 'sl.deviceToken',
  seeded: 'sl.seeded',
  seedVersion: 'sl.seedVersion',
  lastExport: 'sl.lastExport',
};

const read = (key, fallback) => {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
};
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));

export const DEFAULT_SETTINGS = {
  haptics: true,
  reducedMotionOverride: false,
  aiEnabled: true,
  dayRolloverHour: 4,      // Q-1: your call. 04:00 means a 1 a.m. entry counts as yesterday.
  sendJournalToAI: false,  // Q-2: default OFF. Journal text does not leave the device.
};

export const DEFAULT_PROFILE = { name: 'Player', birthdate: null, heightCm: null, weightLog: [], avatarEmoji: '◆' };

export const getSettings = () => ({ ...DEFAULT_SETTINGS, ...read(LS.settings, {}) });
export const saveSettings = (patch) => { const s = { ...getSettings(), ...patch }; write(LS.settings, s); return s; };
export const getProfile = () => ({ ...DEFAULT_PROFILE, ...read(LS.profile, {}) });
export const saveProfile = (patch) => { const p = { ...getProfile(), ...patch }; write(LS.profile, p); return p; };
export const getDerived = () => read(LS.derived, null);
export const getLastExport = () => read(LS.lastExport, null);
export const markExported = () => write(LS.lastExport, nowIso());

export function deviceToken() {
  let t = read(LS.deviceToken, null);
  if (!t) { t = uid(); write(LS.deviceToken, t); }
  return t;
}

export const today = () => dayKey(new Date(), getSettings().dayRolloverHour);

/* ---------- Templates ---------- */

export const allTemplates = () => db.all('taskTemplates');
export const activeTemplates = async () =>
  (await db.all('taskTemplates')).filter((t) => t.active).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

export async function saveTemplate(t) {
  const row = {
    id: t.id || uid(),
    name: t.name.trim(),
    statWeights: t.statWeights || {},
    difficulty: t.difficulty || 2,
    kind: t.kind || 'habit',
    cadence: t.cadence || (t.kind === 'oneoff' ? 'once' : 'daily'),
    active: t.active !== false,
    createdAt: t.createdAt || nowIso(),
    archivedAt: t.archivedAt || null,
  };
  await db.put('taskTemplates', row);
  emit('data:changed', { store: 'taskTemplates' });
  return row;
}

export async function archiveTemplate(id) {
  const t = await db.get('taskTemplates', id);
  if (!t) return;
  await db.put('taskTemplates', { ...t, active: false, archivedAt: nowIso() });
  emit('data:changed', { store: 'taskTemplates' });
}

/* ---------- Completions: the event log ---------- */

export const completionsForDay = (day) => db.byIndex('completions', 'date', day);
export const allCompletions = () => db.all('completions');

export async function countTemplateToday(templateId, day) {
  if (!templateId) return 0;
  const rows = await completionsForDay(day);
  return rows.filter((c) => c.templateId === templateId && !c.revoked).length;
}

/**
 * The completion pipeline. Everything that grants XP goes through here — tasks, quests,
 * milestones, bonuses — so the log stays the one true ledger.
 * xp and statPoints are FROZEN on the row: rebalancing xp.js in v1.2 must never silently
 * rewrite history (§3.1).
 */
export async function complete({ templateId = null, name, difficulty = 2, statWeights = {}, source = 'task', xp = null, statPoints = null, day = null }) {
  const d = day || today();
  const prior = await countTemplateToday(templateId, d);
  const before = (getDerived()?.totalXp) ?? 0;

  const row = {
    id: uid(),
    templateId,
    name,
    date: d,
    completedAt: nowIso(),
    xp: xp ?? XP.xpForCompletion(difficulty, prior),
    statPoints: statPoints ?? XP.statPointsFor(difficulty, statWeights, prior),
    source,
    revoked: false,
  };
  await db.put('completions', row);

  const derived = await recomputeDerived();
  emit('xp:gained', { amount: row.xp, row });
  const newLevel = XP.levelCrossed(before, derived.totalXp);
  if (newLevel) emit('level:up', { level: newLevel });
  emit('data:changed', { store: 'completions' });
  return row;
}

/** Un-checking tombstones. Nothing is ever deleted from the log. */
export async function revoke(id) {
  const row = await db.get('completions', id);
  if (!row || row.revoked) return;
  const td = today();
  const template = row.templateId ? await db.get('taskTemplates', row.templateId) : null;
  const cadence = template?.cadence || (template?.kind === 'habit' ? 'daily' : 'once');
  const inOpenPeriod = row.date === td
    || (cadence === 'weekly' && isoWeekKey(row.date) === isoWeekKey(td))
    || (cadence === 'monthly' && monthKey(row.date) === monthKey(td));
  if (!inOpenPeriod) return; // closed periods are immutable
  await db.put('completions', { ...row, revoked: true });
  await recomputeDerived();
  emit('data:changed', { store: 'completions' });
}

/** Grant a bonus as a log row, so bonuses are replayable like everything else. */
export async function grantBonus(name, xp, { statPoints = {}, day = null } = {}) {
  return complete({ name, source: 'bonus', xp, statPoints, day });
}

/* ---------- Journal ---------- */

export async function journalForDay(day) {
  const rows = await db.byIndex('journalEntries', 'date', day);
  return rows[0] || null;
}
export const allJournal = () => db.all('journalEntries');

export async function saveJournal(day, text, mood = null) {
  const existing = await journalForDay(day);
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const row = existing
    ? { ...existing, text, mood: mood ?? existing.mood, wordCount, updatedAt: nowIso() }
    : { id: uid(), date: day, text, mood, wordCount, createdAt: nowIso(), updatedAt: nowIso() };
  const wasEmpty = !existing || existing.wordCount === 0;
  await db.put('journalEntries', row);
  await recomputeDerived();
  if (wasEmpty && wordCount > 0) emit('streak:tick', { kind: 'journal' });
  emit('data:changed', { store: 'journalEntries' });
  return row;
}

/* ---------- Goals ---------- */

export const allGoals = () => db.all('goals');

export async function saveGoal(g) {
  const row = {
    id: g.id || uid(),
    title: g.title.trim(),
    horizon: g.horizon || 'milestone',
    statWeights: g.statWeights || {},
    milestones: g.milestones || [],
    manualProgress: g.manualProgress ?? null,
    linkedTemplateIds: g.linkedTemplateIds || [],
    status: g.status || 'active',
    createdAt: g.createdAt || nowIso(),
    achievedAt: g.achievedAt || null,
    xpAward: g.xpAward ?? XP.GOAL_XP_BASE * (XP.HORIZON_MULT[g.horizon || 'milestone']), // frozen at creation
  };
  await db.put('goals', row);
  emit('data:changed', { store: 'goals' });
  return row;
}

/** Toggle a sub-milestone. Grants XP exactly once — the guard is `done`, on the row itself. */
export async function toggleMilestone(goalId, milestoneId) {
  const goal = await db.get('goals', goalId);
  if (!goal) return null;
  const ms = goal.milestones.find((m) => m.id === milestoneId);
  if (!ms) return null;

  ms.done = !ms.done;
  ms.doneAt = ms.done ? nowIso() : null;
  await db.put('goals', goal);

  if (ms.done) {
    await complete({
      name: `Milestone: ${ms.title}`,
      source: 'bonus',
      xp: XP.MILESTONE_XP,
      statPoints: XP.statPointsFor(3, goal.statWeights, 0),
    });
  }

  // Whole goal cleared?
  const done = goal.milestones.filter((m) => m.done).length;
  if (goal.milestones.length && done === goal.milestones.length && goal.status === 'active') {
    goal.status = 'achieved';
    goal.achievedAt = nowIso();
    await db.put('goals', goal);
    await complete({
      name: `Goal achieved: ${goal.title}`,
      source: 'bonus',
      xp: goal.xpAward,
      statPoints: XP.statPointsFor(5, goal.statWeights, 0),
    });
    emit('goal:achieved', { goal });
  }
  emit('data:changed', { store: 'goals' });
  return goal;
}

/* ---------- Quests ---------- */

export const questForDay = async (day) => (await db.byIndex('dailyQuests', 'date', day))[0] || null;

/** Lazily generate on first open of a new day. Deterministic: reopening never rerolls. */
export async function ensureQuest(day = today()) {
  const existing = await questForDay(day);
  if (existing) return existing;

  const derived = getDerived() || (await recomputeDerived());
  const recent = [];
  for (const d of cooldownWindow(day)) {
    const q = await questForDay(d);
    if (q) recent.push(q.questPoolId);
  }
  const spec = generateQuest({
    date: day,
    weakest: derived.weakest || TRAINABLE.slice(0, 3),
    level: derived.level || 1,
    recentQuestIds: recent,
  });
  if (!spec) return null;
  const row = { id: uid(), ...spec };
  await db.put('dailyQuests', row);
  return row;
}

export async function rerollQuest(day = today()) {
  const q = await questForDay(day);
  if (!q || q.rerolled || q.status === 'completed') return q;
  const derived = getDerived();
  const recent = [];
  for (const d of cooldownWindow(day)) {
    const prev = await questForDay(d);
    if (prev) recent.push(prev.questPoolId);
  }
  const spec = generateQuest({
    date: day,
    weakest: derived.weakest,
    level: derived.level,
    recentQuestIds: recent,
    excludeIds: [q.questPoolId],
    salt: 'reroll',
  });
  if (!spec) return q;
  const row = { ...q, ...spec, rerolled: true, status: 'offered' };
  await db.put('dailyQuests', row);
  emit('data:changed', { store: 'dailyQuests' });
  return row;
}

export async function completeQuest(day = today()) {
  const q = await questForDay(day);
  if (!q || q.status === 'completed') return null;
  await db.put('dailyQuests', { ...q, status: 'completed', completedAt: nowIso() });
  const row = await complete({
    name: `Quest: ${q.name}`,
    source: 'quest',
    difficulty: q.difficulty,
    statWeights: { [q.statId]: 1 },
    xp: q.bonusXp,
    statPoints: XP.statPointsFor(q.difficulty, { [q.statId]: 1 }, 0),
    day,
  });
  emit('quest:completed', { quest: q });
  await checkDayClear(day);
  return row;
}

/* ---------- Morning + night routine quests ---------- */

const buildRoutineState = (routine, day, rows) => {
  const live = rows.filter((row) => !row.revoked);
  const stepRows = Object.fromEntries(routine.steps.map((step) => [
    step.id,
    live.find((row) => row.templateId === routineStepTemplateId(routine.id, step.id)) || null,
  ]));
  const award = live.find((row) => row.templateId === routineAwardTemplateId(routine.id)) || null;
  return {
    ...routine,
    day,
    stepRows,
    doneCount: routine.steps.filter((step) => stepRows[step.id]).length,
    completed: !!award,
    award,
  };
};

/** Only unlocked, unfinished routines are returned to Today. */
export async function activeRoutineStates(now = new Date()) {
  const day = easternClock(now).day;
  const rows = await completionsForDay(day);
  return availableRoutines(now)
    .map((routine) => buildRoutineState(routine, day, rows))
    .filter((state) => !state.completed);
}

export async function routineState(routineId, now = new Date()) {
  const routine = routineById(routineId);
  if (!routine || !availableRoutines(now).some((candidate) => candidate.id === routineId)) return null;
  const day = easternClock(now).day;
  return buildRoutineState(routine, day, await completionsForDay(day));
}

async function recordRoutineStep(routine, step, day) {
  const row = {
    id: uid(),
    templateId: routineStepTemplateId(routine.id, step.id),
    name: `${routine.name}: ${step.name}`,
    date: day,
    completedAt: nowIso(),
    xp: 0,
    statPoints: {},
    source: 'routine-step',
    revoked: false,
  };
  await db.put('completions', row);
  await recomputeDerived();
  emit('data:changed', { store: 'completions' });
  return row;
}

/** Toggle one checklist item and automatically pay the routine award on the final item. */
export async function toggleRoutineStep(routineId, stepId, now = new Date()) {
  const routine = routineById(routineId);
  const state = await routineState(routineId, now);
  if (!routine || !state || state.completed) return { state, award: null };
  const step = routine.steps.find((candidate) => candidate.id === stepId);
  if (!step) return { state, award: null };

  const existing = state.stepRows[stepId];
  if (existing) {
    await db.put('completions', { ...existing, revoked: true });
    await recomputeDerived();
    emit('data:changed', { store: 'completions' });
    return { state: await routineState(routineId, now), award: null };
  }

  await recordRoutineStep(routine, step, state.day);
  const updated = await routineState(routineId, now);
  if (!updated || updated.doneCount !== routine.steps.length) return { state: updated, award: null };

  // Re-read before awarding so rapid taps/reopens cannot pay this routine twice.
  const alreadyAwarded = (await completionsForDay(state.day))
    .some((row) => !row.revoked && row.templateId === routineAwardTemplateId(routine.id));
  if (alreadyAwarded) return { state: await routineState(routineId, now), award: null };

  const award = await complete({
    templateId: routineAwardTemplateId(routine.id),
    name: routine.name,
    source: 'routine',
    xp: routine.bonusXp,
    statPoints: XP.statPointsFor(3, routine.statWeights, 0),
    day: state.day,
  });
  emit('routine:completed', { routine, award });
  return { state: await routineState(routineId, now), award };
}

/* ---------- Bonuses: day clear + reboot ---------- */

const hasBonus = async (day, name) =>
  (await completionsForDay(day)).some((c) => !c.revoked && c.source === 'bonus' && c.name === name);

/** All active habits + the quest → +25 XP. Quiet stamp, not fireworks. */
export async function checkDayClear(day = today()) {
  if (await hasBonus(day, 'Day cleared')) return false;
  const habits = (await activeTemplates()).filter((t) => t.kind === 'habit' && (t.cadence || 'daily') === 'daily');
  if (!habits.length) return false;

  const rows = (await completionsForDay(day)).filter((c) => !c.revoked);
  const doneIds = new Set(rows.map((c) => c.templateId));
  const allHabits = habits.every((h) => doneIds.has(h.id));
  const quest = await questForDay(day);
  const questDone = !quest || quest.status === 'completed';

  if (allHabits && questDone) {
    await grantBonus('Day cleared', XP.DAY_CLEAR_BONUS, { day });
    emit('day:cleared', { day });
    return true;
  }
  return false;
}

/** Rewarding the return is cheaper than punishing the absence (§5.5). */
export async function maybeRebootBonus(day = today()) {
  if (await hasBonus(day, 'System reboot')) return null;
  const derived = getDerived();
  if (!derived?.activeDays?.length) return null;
  const active = new Set(derived.activeDays);
  if (active.has(day)) return null;
  const { reboot, missed } = needsReboot(active, { rolloverHour: getSettings().dayRolloverHour });
  if (!reboot) return null;
  return { missed, grant: () => grantBonus('System reboot', XP.REBOOT_BONUS, { day }) };
}

/**
 * Charge each unfinished habit once after its day closes. Penalties are ledger rows, just
 * like rewards, so replaying the log is deterministic and reopening cannot charge twice.
 * XP never drops below zero and missed work never creates a hidden XP debt.
 */
export async function applyMissedDailyPenalties(fromDay, toDay = today()) {
  if (!fromDay || daysBetween(fromDay, toDay) <= 0) return [];

  const templates = await allTemplates();
  const added = [];
  for (let day = fromDay; daysBetween(day, toDay) > 0; day = addDays(day, 1)) {
    const rows = await completionsForDay(day);
    const completed = new Set(rows.filter((c) => !c.revoked && c.source !== 'penalty').map((c) => c.templateId));
    const alreadyCharged = new Set(rows.filter((c) => !c.revoked && c.source === 'penalty').map((c) => c.templateId));
    const habits = templates.filter((t) => {
      if (t.kind !== 'habit' || (t.cadence || 'daily') !== 'daily') return false;
      const created = t.createdAt?.slice(0, 10) || day;
      const archived = t.archivedAt?.slice(0, 10) || null;
      return created <= day && (!archived || archived > day);
    });

    for (const habit of habits) {
      if (completed.has(habit.id) || alreadyCharged.has(habit.id)) continue;
      const available = Math.max(0, getDerived()?.totalXp ?? (await recomputeDerived()).totalXp);
      if (available <= 0) continue;
      const loss = Math.min(XP.MISSED_DAILY_PENALTY, available);
      const row = {
        id: uid(), templateId: habit.id, name: `Missed: ${habit.name}`, date: day,
        completedAt: nowIso(), xp: -loss, statPoints: {}, source: 'penalty', revoked: false,
      };
      await db.put('completions', row);
      await recomputeDerived();
      added.push(row);
    }
  }
  if (added.length) emit('data:changed', { store: 'completions' });
  return added;
}

/* ---------- The derived snapshot ---------- */

/**
 * Replay the log. This function IS the spec — sl.derived is only a cache of its output.
 * Run on: every completion, every import, every tombstone, and boot.
 */
export async function recomputeDerived() {
  const { dayRolloverHour } = getSettings();
  const now = new Date();
  const td = dayKey(now, dayRolloverHour);

  const [completions, journal, goals] = await Promise.all([db.all('completions'), db.all('journalEntries'), db.all('goals')]);
  const live = completions.filter((c) => !c.revoked);

  const totalXp = Math.max(0, live.reduce((sum, c) => sum + (c.xp || 0), 0));
  const { level, into, needed, ratio } = XP.progress(totalXp);

  // Penalties are bookkeeping, not activity; missing a habit must never preserve a streak.
  const logDays = new Set(live.filter((c) => c.source !== 'penalty').map((c) => c.date));
  const journalDays = new Set(journal.filter((j) => j.wordCount > 0).map((j) => j.date));

  const logS = computeStreak(logDays, { now, rolloverHour: dayRolloverHour });
  const jS = computeStreak(journalDays, { now, rolloverHour: dayRolloverHour });

  const last30 = new Set(trailingWindow(td, 30));
  const daysLogged30 = [...logDays].filter((d) => last30.has(d)).length;
  const milestones30 = goals.flatMap((g) => g.milestones || [])
    .filter((m) => m.done && m.doneAt && daysBetween(m.doneAt.slice(0, 10), td) <= 30).length;

  const axes = computeRadar(completions, {
    now, rolloverHour: dayRolloverHour, win: 'ALL',
    potentialInputs: { journalStreak: jS.current, logStreak: logS.current, daysLogged30, milestones30 },
  });

  const derived = {
    totalXp, level, into, needed, ratio,
    axes: axes.map(({ id, value, stale, lifetimePoints, points30 }) => ({ id, value, stale, lifetimePoints, points30 })),
    weakest: weakestStats(axes, 3),
    journalStreak: jS.current, journalBest: jS.best,
    logStreak: logS.current, logBest: logS.best,
    freezeTokens: Math.max(jS.tokens, logS.tokens),
    frozenDays: [...jS.frozenDays],
    logFrozenDays: [...logS.frozenDays],
    activeDays: [...logDays],
    journalDays: [...journalDays],
    daysLogged30,
    lastRecomputeAt: nowIso(),
  };
  write(LS.derived, derived);
  emit('derived:updated', derived);
  return derived;
}

/* ---------- First launch ---------- */

// Q-5: edit these to YOUR actual routine before you rely on Phase 1. An empty Today on day
// one kills the loop before it starts, so the app refuses to open with nothing in it.
export const STARTER_HABITS = [
  { name: 'Clean for 30 minutes', difficulty: 2, statWeights: { discipline: 0.7, productivity: 0.5 } },
  { name: 'Run / cardio', difficulty: 3, statWeights: { health: 1, discipline: 0.3 } },
  { name: 'Weight lifting session', difficulty: 4, statWeights: { health: 1, discipline: 0.4, looks: 0.3 } },
  { name: 'Eat clean food only', difficulty: 3, statWeights: { health: 0.8, discipline: 0.6 } },
  { name: 'Improve speaking ability', difficulty: 2, statWeights: { social: 0.8, status: 0.4 } },
  { name: 'Read', difficulty: 2, statWeights: { intelligence: 1, discipline: 0.2 } },
  { name: 'Learn about psychology', difficulty: 2, statWeights: { intelligence: 1, relationships: 0.3 } },
  { name: 'Routine Followed', difficulty: 3, statWeights: { health: 0.8, discipline: 0.5 } },
  { name: 'Journal / reflect', difficulty: 2, statWeights: { intelligence: 0.6, discipline: 0.4 } },
  { name: 'Stretch', difficulty: 1, statWeights: { health: 0.7, discipline: 0.2 } },
  { name: 'Practice a new skill', difficulty: 3, statWeights: { intelligence: 0.8, productivity: 0.5 } },
  { name: 'Drink water', difficulty: 1, statWeights: { health: 1 } },
];

const LEGACY_STARTER_NAMES = new Set([
  'Journal the day', 'Train', 'Read 20 minutes', 'No junk food', 'Deep work block', 'Sleep by target time',
]);
const STARTER_VERSION = 3;

export async function seedIfFirstLaunch() {
  if ((read(LS.seedVersion, 0) >= STARTER_VERSION)) return false;
  const existing = await db.all('taskTemplates');
  const migrationTime = nowIso();
  // Preserve the original template id so past completions still connect to this habit.
  for (const t of existing.filter((template) => template.name.toLowerCase() === 'fix sleep')) {
    await db.put('taskTemplates', { ...t, name: 'Routine Followed' });
    t.name = 'Routine Followed';
  }
  const legacyMatches = existing.filter((t) => t.active && LEGACY_STARTER_NAMES.has(t.name));
  // Require a recognizable bundle so a user-created task coincidentally named "Train" survives.
  if (legacyMatches.length >= 3) {
    for (const t of legacyMatches) {
      await db.put('taskTemplates', { ...t, active: false, archivedAt: t.createdAt || migrationTime });
    }
  }
  const names = new Set(existing.filter((t) => t.active && !LEGACY_STARTER_NAMES.has(t.name)).map((t) => t.name));
  for (const h of STARTER_HABITS) {
    if (!names.has(h.name)) await saveTemplate({ ...h, kind: 'habit' });
  }
  write(LS.seeded, true);
  write(LS.seedVersion, STARTER_VERSION);
  return true;
}

/** Day rollover check on open. Returns the day key, and whether it changed. */
export function rollover() {
  const td = today();
  const last = read(LS.lastOpenDate, null);
  write(LS.lastOpenDate, td);
  if (last && last !== td) emit('day:rolled', { from: last, to: td });
  return { day: td, rolled: last !== td, previous: last };
}

export { LS, uid, nowIso, read as lsRead, write as lsWrite };
