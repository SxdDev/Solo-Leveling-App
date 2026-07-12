// stats.js — the radar math (plan §5.3). Pure. No decay, ever.

import { dayKey, addDays, daysBetween, trailingWindow } from './dates.js';

// Q-3 is still open: these one-line definitions are MINE, not yours. Rewrite them in your
// own words before Phase 2 — if you don't agree with them, task-mapping goes mushy and the
// chart stops meaning anything.
export const STATS = [
  { id: 'status',        name: 'Status',        glyph: '◆', def: 'Standing and reputation — what people who matter know you for.' },
  { id: 'money',         name: 'Money',         glyph: '⬡', def: 'Income, savings, and the habits that grow both.' },
  { id: 'health',        name: 'Health',        glyph: '✚', def: 'Body: training, sleep, food, energy.' },
  { id: 'intelligence',  name: 'Intelligence',  glyph: '✦', def: 'Knowledge and skill deliberately acquired.' },
  { id: 'discipline',    name: 'Discipline',    glyph: '▲', def: 'Doing it when you don\'t feel like it.' },
  { id: 'social',        name: 'Social Skills', glyph: '◈', def: 'Ease and effectiveness with people, especially strangers.' },
  { id: 'looks',         name: 'Looks',         glyph: '❖', def: 'Grooming, style, presentation — the controllables.' },
  { id: 'relationships', name: 'Relationships', glyph: '♥', def: 'Depth of the bonds you already have.' },
  { id: 'network',       name: 'Network',       glyph: '⌬', def: 'Breadth of useful connections you actively maintain.' },
  { id: 'productivity',  name: 'Productivity',  glyph: '⚙', def: 'Output shipped per unit of time.' },
  { id: 'potential',     name: 'Potential',     glyph: '◎', def: 'Derived — how hard you are currently compounding.' },
];

export const STAT_IDS = STATS.map((s) => s.id);
export const TRAINABLE = STAT_IDS.filter((id) => id !== 'potential');
export const statById = (id) => STATS.find((s) => s.id === id);

// ⚠ PLAN CORRECTION (§5.3). The plan's formula and its calibration numbers disagree.
// With SATURATION = 900, the real anchors are:
//     value 10 → ~95 pts · value 50 → ~624 pts · value 75 → ~1,248 pts · value 80 → ~1,448 pts
// The plan's parenthetical ("~2,070 → 50; ~4,140 → 75") corresponds to SATURATION ≈ 2,986,
// not 900. Only its first anchor (~90 → 10) matches the stated formula.
// Shipped as written, because the formula is the decision and the anchors are commentary —
// but this is the single number most worth tuning in Phase 2 against real logging volume.
// Raising it slows every axis; lowering it makes the chart fill fast and then flatten.
export const SATURATION = 900;
export const BASELINE_FLOOR = 60; // stops week-one divide-by-tiny noise
export const BLEND = { lifetime: 0.7, window: 0.3 };
export const DIM_AFTER_DAYS = 14;

/** Soft-saturating: early gains move fast, mastery slows. Never decreases. */
export const lifetimeValue = (P) => 100 * (1 - Math.exp(-P / SATURATION));

/** Trailing-30d activity against your own best 30d window for that stat. */
export const windowValue = (P30, best30) =>
  100 * Math.min(1, P30 / Math.max(best30, BASELINE_FLOOR));

export const blend = (life, win) => BLEND.lifetime * life + BLEND.window * win;

/** Sum statPoints across completions into { statId: points }. Ignores revoked rows. */
export function sumStatPoints(completions) {
  const out = {};
  for (const c of completions) {
    if (c.revoked) continue;
    for (const [id, p] of Object.entries(c.statPoints || {})) out[id] = (out[id] || 0) + p;
  }
  return out;
}

/** { dayKey: { statId: pts } } — the spine of every window calc. */
export function pointsByDay(completions) {
  const byDay = {};
  for (const c of completions) {
    if (c.revoked) continue;
    const d = (byDay[c.date] ||= {});
    for (const [id, p] of Object.entries(c.statPoints || {})) d[id] = (d[id] || 0) + p;
  }
  return byDay;
}

/** Best rolling 30-day total per stat, over all history. This is your personal baseline. */
export function best30Windows(byDay, todayKey) {
  const days = Object.keys(byDay).sort();
  const best = {};
  for (const id of TRAINABLE) best[id] = 0;
  if (!days.length) return best;
  const start = days[0];
  for (let k = start; daysBetween(k, todayKey) >= 0; k = addDays(k, 1)) {
    const win = trailingWindow(k, 30);
    for (const id of TRAINABLE) {
      let sum = 0;
      for (const d of win) sum += byDay[d]?.[id] || 0;
      if (sum > best[id]) best[id] = sum;
    }
  }
  return best;
}

/**
 * Potential (§5.3): derived, untrainable. Streak health + 30d consistency + goal momentum.
 * Answers "how much is this person compounding right now?" and sags honestly when you coast.
 */
export function potentialValue({ journalStreak = 0, logStreak = 0, daysLogged30 = 0, milestones30 = 0 }) {
  const streakScore = Math.min(1, (journalStreak + logStreak) / 60);   // 30+30 days = full
  const consistency = Math.min(1, daysLogged30 / 30);
  const momentum = Math.min(1, milestones30 / 4);                       // 4 milestones/month = full
  return 100 * (0.35 * streakScore + 0.45 * consistency + 0.20 * momentum);
}

/**
 * The whole radar, for one time window.
 * win: 'W' | 'M' | 'Y' | 'ALL'.
 *  - ALL  → blended character sheet: 0.7 lifetime + 0.3 trailing-30d.
 *  - W/M/Y → shape of that window's activity, normalized to its own max axis (an honest
 *            activity mirror, not a shrunken lifetime chart).
 */
export function computeRadar(completions, { now = new Date(), rolloverHour = 4, win = 'ALL', potentialInputs = {} } = {}) {
  const today = dayKey(now, rolloverHour);
  const byDay = pointsByDay(completions);
  const lifetime = sumStatPoints(completions);
  const best30 = best30Windows(byDay, today);

  const sumWindow = (n) => {
    const out = {};
    for (const d of trailingWindow(today, n)) {
      for (const [id, p] of Object.entries(byDay[d] || {})) out[id] = (out[id] || 0) + p;
    }
    return out;
  };
  const p30 = sumWindow(30);

  const lastActivity = {};
  for (const [d, stats] of Object.entries(byDay)) {
    for (const id of Object.keys(stats)) {
      if (!lastActivity[id] || d > lastActivity[id]) lastActivity[id] = d;
    }
  }

  const potential = potentialValue(potentialInputs);

  const allAxes = TRAINABLE.map((id) => {
    const life = lifetimeValue(lifetime[id] || 0);
    const wv = windowValue(p30[id] || 0, best30[id]);
    return {
      id, name: statById(id).name, glyph: statById(id).glyph,
      lifetimePoints: +(lifetime[id] || 0).toFixed(1),
      points30: +(p30[id] || 0).toFixed(1),
      lifetimeValue: life,
      windowValue: wv,
      value: blend(life, wv),
      lastActivity: lastActivity[id] || null,
      stale: !lastActivity[id] || daysBetween(lastActivity[id], today) >= DIM_AFTER_DAYS,
    };
  });

  if (win === 'ALL') {
    return [...allAxes, {
      id: 'potential', name: 'Potential', glyph: '◎', derived: true,
      lifetimePoints: 0, points30: 0,
      lifetimeValue: potential, windowValue: potential, value: potential,
      lastActivity: null, stale: potential < 5,
    }];
  }

  // Windowed view: normalize the window's points to its own busiest axis.
  const n = win === 'W' ? 7 : win === 'M' ? 30 : 365;
  const pw = sumWindow(n);
  const max = Math.max(1, ...TRAINABLE.map((id) => pw[id] || 0));
  const windowed = allAxes.map((a) => ({
    ...a,
    points30: +(pw[a.id] || 0).toFixed(1),
    value: (100 * (pw[a.id] || 0)) / max,
  }));
  return [...windowed, {
    id: 'potential', name: 'Potential', glyph: '◎', derived: true,
    lifetimePoints: 0, points30: 0, lifetimeValue: potential, windowValue: potential,
    value: potential, lastActivity: null, stale: potential < 5,
  }];
}

/** The 3 weakest trainable stats — feeds quest generation (§5.4). */
export function weakestStats(axes, n = 3) {
  return axes
    .filter((a) => a.id !== 'potential')
    .slice()
    .sort((a, b) => a.value - b.value)
    .slice(0, n)
    .map((a) => a.id);
}
