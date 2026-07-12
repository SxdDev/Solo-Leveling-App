// summarizer.js — the CLIENT compresses, not the function (§6.2).
// The device decides what leaves the device. Nothing here dumps raw history.
// Journal text: only ever sent if settings.sendJournalToAI is explicitly true (Q-2, default OFF).

import * as store from '../store.js';
import * as db from '../db.js';
import { STATS, TRAINABLE, statById } from '../game/stats.js';
import { dayKey, addDays, dayRange, isoWeekKey, monthKey, trailingWindow, daysBetween } from '../game/dates.js';

const round = (n) => Math.round(n * 10) / 10;

const ageBand = (birthdate) => {
  if (!birthdate) return null;
  const age = Math.floor(daysBetween(birthdate, dayKey()) / 365.25);
  if (age < 20) return 'under 20';
  if (age < 25) return '20–24';
  if (age < 30) return '25–29';
  if (age < 40) return '30s';
  return '40+';
};

const profileBlock = () => {
  const p = store.getProfile();
  return { name: p.name, ageBand: ageBand(p.birthdate) }; // never height/weight
};

const statPointsIn = (completions, days) => {
  const set = new Set(days);
  const out = {};
  for (const id of TRAINABLE) out[id] = 0;
  for (const c of completions) {
    if (c.revoked || !set.has(c.date)) continue;
    for (const [id, p] of Object.entries(c.statPoints || {})) out[id] = round((out[id] || 0) + p);
  }
  return out;
};

const xpIn = (completions, days) => {
  const set = new Set(days);
  return completions.filter((c) => !c.revoked && set.has(c.date)).reduce((s, c) => s + c.xp, 0);
};

export async function buildDaily(day = store.today()) {
  const settings = store.getSettings();
  const derived = store.getDerived();
  const [rows, quest, entry] = await Promise.all([
    store.completionsForDay(day),
    store.questForDay(day),
    store.journalForDay(day),
  ]);
  const live = rows.filter((c) => !c.revoked);
  const yesterday = addDays(day, -1);
  const yRows = (await store.completionsForDay(yesterday)).filter((c) => !c.revoked);

  const journal = entry
    ? {
        wordCount: entry.wordCount,
        mood: entry.mood,
        // Q-2: OFF by default. Flip it in Settings if you want the daily review to actually
        // read what you wrote. The text leaves the device if you do — that's the trade.
        ...(settings.sendJournalToAI && entry.text ? { excerpt: entry.text.slice(0, 400) } : {}),
      }
    : null;

  return {
    date: day,
    level: derived?.level ?? 1,
    xpToday: live.reduce((s, c) => s + c.xp, 0),
    xpYesterday: yRows.reduce((s, c) => s + c.xp, 0),
    completions: live.slice(0, 30).map((c) => ({
      name: c.name,
      stats: Object.keys(c.statPoints || {}).map((id) => statById(id)?.name).filter(Boolean),
      xp: c.xp,
    })),
    quest: quest ? { name: quest.name, stat: statById(quest.statId)?.name, status: quest.status } : null,
    streaks: {
      journal: derived?.journalStreak ?? 0,
      logging: derived?.logStreak ?? 0,
      freezeTokens: derived?.freezeTokens ?? 0,
    },
    journal,
    profile: profileBlock(),
  };
}

export async function buildWeekly(weekKeyStr, day = store.today()) {
  const derived = store.getDerived();
  const completions = await store.allCompletions();
  const [templates, quests, journal] = await Promise.all([
    store.allTemplates(), db.all('dailyQuests'), store.allJournal(),
  ]);

  const week = trailingWindow(day, 7);
  const prev = trailingWindow(addDays(day, -7), 7);

  const thisWeek = statPointsIn(completions, week);
  const lastWeek = statPointsIn(completions, prev);

  const deltas = TRAINABLE.map((id) => ({
    stat: statById(id).name,
    points: thisWeek[id],
    delta: round(thisWeek[id] - lastWeek[id]),
  })).sort((a, b) => b.delta - a.delta);

  const weekSet = new Set(week);
  const habitRates = templates.filter((t) => t.kind === 'habit' && t.active).map((t) => ({
    habit: t.name,
    completed: completions.filter((c) => !c.revoked && c.templateId === t.id && weekSet.has(c.date)).length,
    outOf: 7,
  }));

  const wq = quests.filter((q) => weekSet.has(q.date));

  return {
    week: weekKeyStr,
    level: derived?.level ?? 1,
    xpPerDay: week.map((d) => xpIn(completions, [d])),
    xpTotal: xpIn(completions, week),
    xpPreviousWeek: xpIn(completions, prev),
    statPoints: thisWeek,
    topMovers: deltas.slice(0, 3),
    bottomMovers: deltas.slice(-3).reverse(),
    zeroStats: TRAINABLE.filter((id) => thisWeek[id] === 0).map((id) => statById(id).name),
    habitRates,
    quests: { offered: wq.length, completed: wq.filter((q) => q.status === 'completed').length },
    // Word counts and moods only. No journal text in weekly payloads, ever (§6.2).
    journal: {
      daysWritten: journal.filter((j) => weekSet.has(j.date) && j.wordCount > 0).length,
      outOf: 7,
      moods: journal.filter((j) => weekSet.has(j.date) && j.mood).map((j) => j.mood),
    },
    streaks: { journal: derived?.journalStreak ?? 0, logging: derived?.logStreak ?? 0 },
    profile: profileBlock(),
  };
}

export async function buildMonthly(mKey, day = store.today()) {
  const derived = store.getDerived();
  const completions = await store.allCompletions();
  const goals = await store.allGoals();
  const days = dayRange(`${mKey}-01`, day).filter((d) => monthKey(d) === mKey);

  const weeks = {};
  for (const d of days) {
    const wk = isoWeekKey(d);
    weeks[wk] = (weeks[wk] || 0) + xpIn(completions, [d]);
  }

  return {
    month: mKey,
    level: derived?.level ?? 1,
    weeklyXp: Object.entries(weeks).map(([week, xp]) => ({ week, xp })),
    statPoints: statPointsIn(completions, days),
    activeDays: new Set(completions.filter((c) => !c.revoked && days.includes(c.date)).map((c) => c.date)).size,
    outOf: days.length,
    streaks: { journalBest: derived?.journalBest ?? 0, loggingBest: derived?.logBest ?? 0 },
    goals: {
      active: goals.filter((g) => g.status === 'active').length,
      achieved: goals.filter((g) => g.status === 'achieved' && monthKey(g.achievedAt?.slice(0, 10) || '') === mKey)
        .map((g) => g.title),
    },
    profile: profileBlock(),
  };
}

export async function buildYearly(yKey, day = store.today()) {
  const derived = store.getDerived();
  const completions = await store.allCompletions();
  const goals = await store.allGoals();
  const live = completions.filter((c) => !c.revoked && c.date.startsWith(yKey));

  const months = {};
  for (const c of live) {
    const m = monthKey(c.date);
    months[m] = (months[m] || 0) + c.xp;
  }

  return {
    year: yKey,
    level: derived?.level ?? 1,
    totalXp: live.reduce((s, c) => s + c.xp, 0),
    monthlyXp: Object.entries(months).map(([month, xp]) => ({ month, xp })),
    statPoints: statPointsIn(completions, [...new Set(live.map((c) => c.date))]),
    activeDays: new Set(live.map((c) => c.date)).size,
    records: { journalBest: derived?.journalBest ?? 0, loggingBest: derived?.logBest ?? 0 },
    goalsAchieved: goals.filter((g) => g.status === 'achieved').map((g) => g.title),
    profile: profileBlock(),
  };
}

export function build(period, periodKey) {
  if (period === 'daily') return buildDaily(periodKey);
  if (period === 'weekly') return buildWeekly(periodKey);
  if (period === 'monthly') return buildMonthly(periodKey);
  return buildYearly(periodKey);
}

/** Guard rail: the function rejects bodies over 32 KB. Fail loudly here, not there. */
export const payloadSize = (obj) => new Blob([JSON.stringify(obj)]).size;
