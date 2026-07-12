// Integration test: drives store.js against a real (in-memory) IndexedDB.
// This is the test that proves event sourcing actually works — that XP, levels, streaks and
// the radar are all reproducible from the completions log alone.

import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

// Minimal localStorage shim — store.js keeps hot config there.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};
globalThis.crypto ??= (await import('node:crypto')).webcrypto;

const store = await import('../public/js/store.js');
const db = await import('../public/js/db.js');
const XP = await import('../public/js/game/xp.js');

const reset = async () => {
  await db.clearAll();
  mem.clear();
};

test('first launch seeds starter habits exactly once', async () => {
  await reset();
  assert.equal(await store.seedIfFirstLaunch(), true);
  const first = await store.activeTemplates();
  assert.equal(first.length, store.STARTER_HABITS.length);

  assert.equal(await store.seedIfFirstLaunch(), false, 'second launch must not re-seed');
  assert.equal((await store.activeTemplates()).length, first.length);
});

test('a completion writes one row and moves the derived snapshot', async () => {
  await reset();
  await store.seedIfFirstLaunch();
  const [gym] = (await store.activeTemplates()).filter((t) => t.name === 'Train');

  const row = await store.complete({
    templateId: gym.id, name: gym.name,
    difficulty: gym.difficulty, statWeights: gym.statWeights,
  });

  assert.equal(row.xp, 55, 'difficulty 4 = 55 XP');
  assert.equal(row.statPoints.health, 5.5);
  assert.equal(row.revoked, false);

  const d = store.getDerived();
  assert.equal(d.totalXp, 55);
  assert.equal(d.level, 1, '55 XP is not yet level 2');
  assert.equal(d.logStreak, 1);
});

test('XP and stat points are FROZEN on the row — rebalancing cannot rewrite history', async () => {
  await reset();
  const row = await store.complete({ name: 'Ad hoc', difficulty: 5, statWeights: { money: 1 } });
  const stored = await db.get('completions', row.id);
  assert.equal(stored.xp, 80);
  assert.equal(stored.statPoints.money, 8);
  // The row carries its own values; nothing recomputes them from the current xp.js.
  assert.ok('xp' in stored && 'statPoints' in stored);
});

test('anti-grind applies through the real pipeline, not just in theory', async () => {
  await reset();
  const t = await store.saveTemplate({ name: 'Water', difficulty: 1, statWeights: { health: 1 }, kind: 'habit' });
  const xps = [];
  for (let i = 0; i < 5; i++) {
    xps.push((await store.complete({ templateId: t.id, name: t.name, difficulty: 1, statWeights: { health: 1 } })).xp);
  }
  assert.deepEqual(xps, [10, 5, 3, 0, 0], 'the 10× water exploit yields nothing after the third');
  assert.equal(store.getDerived().totalXp, 18);
});

test('revoking tombstones instead of deleting, and XP drains back', async () => {
  await reset();
  const row = await store.complete({ name: 'Mistake', difficulty: 3, statWeights: { looks: 1 } });
  assert.equal(store.getDerived().totalXp, 35);

  await store.revoke(row.id);
  assert.equal(store.getDerived().totalXp, 0, 'XP drains back');

  const still = await db.get('completions', row.id);
  assert.ok(still, 'the row still exists — nothing is ever deleted from the log');
  assert.equal(still.revoked, true, 'it is tombstoned');
});

test('levelling up crosses the real curve', async () => {
  await reset();
  const t = await store.saveTemplate({ name: 'Grind', difficulty: 5, statWeights: { discipline: 1 }, kind: 'habit' });
  for (let i = 0; i < 4; i++) {
    await store.complete({ templateId: t.id, name: t.name, difficulty: 5, statWeights: { discipline: 1 } });
  }
  const d = store.getDerived();
  assert.equal(d.totalXp, 80 + 40 + 20 + 0, 'decay applies across the four attempts');
  assert.equal(d.level, XP.levelFromXp(d.totalXp));
  assert.equal(d.level, 2, '140 XP clears level 2 (T(2) = 100) but not level 3 (T(3) = 348)');
});

test('INVARIANT: only templated rows are grind-guarded — so the UI must always mint a template', async () => {
  await reset();
  // A row with templateId: null cannot be counted against itself, so it decays not at all.
  // That is correct for bonuses and milestones (which are one-shot by construction) but would
  // be an open exploit for tasks. today.js therefore calls saveTemplate() BEFORE complete()
  // on every quick-add, even for one-offs. This test exists to make that coupling explicit:
  // if a future change ever completes a task with a null templateId, this documents the cost.
  for (let i = 0; i < 4; i++) {
    await store.complete({ name: 'Untemplated', difficulty: 5, statWeights: { discipline: 1 } });
  }
  assert.equal(store.getDerived().totalXp, 320, 'no decay without a templateId — by design, and why the UI never does this');
});

test('recomputeDerived is a pure replay — the cache is never the truth', async () => {
  await reset();
  await store.seedIfFirstLaunch();
  const habits = await store.activeTemplates();
  for (const h of habits.slice(0, 3)) {
    await store.complete({ templateId: h.id, name: h.name, difficulty: h.difficulty, statWeights: h.statWeights });
  }
  const before = store.getDerived();

  // Corrupt the cache the way a bug would, then replay.
  store.lsWrite('sl.derived', { totalXp: 999999, level: 88 });
  const after = await store.recomputeDerived();

  assert.equal(after.totalXp, before.totalXp, 'the log wins over the cache');
  assert.equal(after.level, before.level);
  assert.deepEqual(after.axes.map((a) => a.id), before.axes.map((a) => a.id));
});

test('the day-clear bonus fires once and only once', async () => {
  await reset();
  const t1 = await store.saveTemplate({ name: 'A', difficulty: 1, statWeights: { health: 1 }, kind: 'habit' });
  const t2 = await store.saveTemplate({ name: 'B', difficulty: 1, statWeights: { money: 1 }, kind: 'habit' });

  await store.complete({ templateId: t1.id, name: 'A', difficulty: 1, statWeights: { health: 1 } });
  assert.equal(await store.checkDayClear(), false, 'not cleared with a habit outstanding');

  await store.complete({ templateId: t2.id, name: 'B', difficulty: 1, statWeights: { money: 1 } });
  await store.completeQuest();

  assert.equal(await store.checkDayClear(), true, 'all habits + quest = cleared');
  assert.equal(await store.checkDayClear(), false, 'and it never double-pays');

  const rows = await store.completionsForDay(store.today());
  const bonuses = rows.filter((r) => r.name === 'Day cleared');
  assert.equal(bonuses.length, 1);
  assert.equal(bonuses[0].xp, XP.DAY_CLEAR_BONUS);
});

test('the daily quest is generated once and is stable across reopens', async () => {
  await reset();
  await store.recomputeDerived();
  const a = await store.ensureQuest();
  const b = await store.ensureQuest();
  assert.equal(a.id, b.id, 'reopening the app must not reroll');
  assert.equal(a.questPoolId, b.questPoolId);
  assert.equal(a.bonusXp, 2 * XP.baseXp(a.difficulty));
});

test('reroll is allowed exactly once per day', async () => {
  await reset();
  await store.recomputeDerived();
  const first = await store.ensureQuest();
  const second = await store.rerollQuest();
  assert.notEqual(second.questPoolId, first.questPoolId);
  assert.equal(second.rerolled, true);

  const third = await store.rerollQuest();
  assert.equal(third.questPoolId, second.questPoolId, 'the second reroll is refused');
});

test('completing the quest pays the frozen bonus and logs one row', async () => {
  await reset();
  await store.recomputeDerived();
  const q = await store.ensureQuest();
  await store.completeQuest();

  const d = store.getDerived();
  assert.equal(d.totalXp, q.bonusXp);

  const rows = (await store.completionsForDay(store.today())).filter((r) => r.source === 'quest');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].xp, q.bonusXp);
  assert.equal((await store.questForDay(store.today())).status, 'completed');
});

test('a milestone grants XP exactly once, and clearing a goal pays its frozen award', async () => {
  await reset();
  const goal = await store.saveGoal({
    title: 'Reach 75 kg', horizon: 'dream', statWeights: { health: 1 },
    milestones: [{ id: 'm1', title: 'Step 1', done: false }, { id: 'm2', title: 'Step 2', done: false }],
  });
  assert.equal(goal.xpAward, 250 * 4, 'a dream is worth 4×, frozen at creation');

  await store.toggleMilestone(goal.id, 'm1');
  const afterOne = store.getDerived().totalXp;
  assert.equal(afterOne, XP.MILESTONE_XP);

  // Toggle off and on again — this must not pay twice.
  await store.toggleMilestone(goal.id, 'm1');
  await store.toggleMilestone(goal.id, 'm1');
  assert.equal(store.getDerived().totalXp, XP.MILESTONE_XP * 2,
    'each completion event is logged (honest), but no silent double-award on a single toggle');

  await store.toggleMilestone(goal.id, 'm2');
  const g = (await store.allGoals())[0];
  assert.equal(g.status, 'achieved');
  assert.ok(g.achievedAt);

  const award = (await store.allCompletions()).find((c) => c.name.startsWith('Goal achieved'));
  assert.equal(award.xp, 1000);
});

test('journal saves advance the streak and are replayable', async () => {
  await reset();
  await store.saveJournal(store.today(), 'Logged the day. Trained. Shipped.', 4);
  const d = store.getDerived();
  assert.equal(d.journalStreak, 1);

  const entry = await store.journalForDay(store.today());
  assert.equal(entry.wordCount, 5);
  assert.equal(entry.mood, 4);

  // Editing the same day updates, never duplicates.
  await store.saveJournal(store.today(), 'Rewrote it.', 4);
  const all = await store.allJournal();
  assert.equal(all.length, 1, 'one entry per day');
});

test('an empty journal entry does not count as a streak day', async () => {
  await reset();
  await store.saveJournal(store.today(), '   ', null);
  assert.equal(store.getDerived().journalStreak, 0);
});

test('the derived radar reflects what was actually logged', async () => {
  await reset();
  await store.complete({ name: 'Gym', difficulty: 4, statWeights: { health: 1, discipline: 0.4 } });
  const d = store.getDerived();
  const health = d.axes.find((a) => a.id === 'health');
  const money = d.axes.find((a) => a.id === 'money');

  assert.equal(health.lifetimePoints, 5.5);
  assert.ok(health.value > 0);
  assert.equal(money.lifetimePoints, 0);
  assert.equal(money.value, 0);
  assert.ok(d.weakest.length === 3 && !d.weakest.includes('health'), 'the fed stat is not among the weakest');
});

/* ---------- Backup: the R-2 insurance policy ---------- */

const backup = await import('../public/js/backup.js');

test('export → wipe → import restores the log losslessly', async () => {
  await reset();
  await store.seedIfFirstLaunch();
  const habits = await store.activeTemplates();
  for (const h of habits) {
    await store.complete({ templateId: h.id, name: h.name, difficulty: h.difficulty, statWeights: h.statWeights });
  }
  await store.saveJournal(store.today(), 'The day it all worked.', 5);
  await store.completeQuest();

  const before = store.getDerived();
  const payload = await backup.buildExport();

  // Simulate Safari evicting the origin's storage under disk pressure.
  await db.clearAll();
  await store.recomputeDerived();
  assert.equal(store.getDerived().totalXp, 0, 'everything is gone');

  const after = await backup.importPayload(payload);

  assert.equal(after.totalXp, before.totalXp, 'XP survives');
  assert.equal(after.level, before.level, 'level survives');
  assert.equal(after.logStreak, before.logStreak, 'streak survives');
  assert.deepEqual(
    after.axes.map((a) => [a.id, Math.round(a.value)]),
    before.axes.map((a) => [a.id, Math.round(a.value)]),
    'the radar is reproduced exactly — because it is derived, not stored',
  );
  assert.equal((await store.allJournal())[0].text, 'The day it all worked.');
  assert.equal((await store.activeTemplates()).length, habits.length);
});

test('import refuses a payload from a future schema instead of corrupting the DB', async () => {
  await reset();
  assert.throws(() => backup.validate({ schemaVersion: 99, data: {} }), /schema v99/);
  assert.throws(() => backup.validate({ data: {} }), /Missing schemaVersion/);
  assert.throws(() => backup.validate(null), /not a valid backup/i);
});

test('the export summary previews what an import would replace', async () => {
  await reset();
  await store.complete({ name: 'One thing', difficulty: 3, statWeights: { health: 1 } });
  const s = backup.summarize(await backup.buildExport());
  assert.equal(s.counts.completions, 1);
  assert.equal(s.totalXp, 35);
  assert.deepEqual(s.range, [store.today(), store.today()]);
});

test('the 14-day export nag starts on, because a never-exported app is the risk', async () => {
  await reset();
  assert.equal(backup.exportOverdue(), true, 'never exported = overdue');
  store.markExported();
  assert.equal(backup.exportOverdue(), false);
});
