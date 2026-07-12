// stats.js (ui) — the mirror.
// W/M/Y show the SHAPE of that window's activity. ALL shows the blended character sheet.
// This is why a bad week visibly dents W but never dents ALL below its lifetime floor.

import { el, clear, panel, sheet } from './dom.js';
import { createRadar } from './radar.js';
import * as store from '../store.js';
import { computeRadar, statById, BLEND } from '../game/stats.js';
import { dayKey, dayRange, windowStart, daysBetween, addDays } from '../game/dates.js';
import { renderReviewCard } from '../ai/review.js';
import { isoWeekKey } from '../game/dates.js';

const WINDOWS = ['W', 'M', 'Y', 'ALL'];

function statSheet(axis, completions, day) {
  sheet(axis.name, () => {
    const meta = statById(axis.id);
    const contributors = {};
    for (const c of completions) {
      if (c.revoked || !c.statPoints?.[axis.id]) continue;
      contributors[c.name] = (contributors[c.name] || 0) + c.statPoints[axis.id];
    }
    const top = Object.entries(contributors).sort((a, b) => b[1] - a[1]).slice(0, 5);

    return el('div', { class: 'stack' },
      el('p', { class: 'muted' }, meta.def),
      panel({},
        el('div', { class: 'kv' }, el('span', {}, 'Displayed value'), el('b', {}, Math.round(axis.value))),
        !axis.derived && el('div', { class: 'kv' },
          el('span', {}, `Lifetime component (${BLEND.lifetime * 100}%)`),
          el('b', {}, Math.round(axis.lifetimeValue))),
        !axis.derived && el('div', { class: 'kv' },
          el('span', {}, `Last 30 days (${BLEND.window * 100}%)`),
          el('b', {}, Math.round(axis.windowValue))),
        !axis.derived && el('div', { class: 'kv' },
          el('span', {}, 'Raw points, lifetime'), el('b', {}, axis.lifetimePoints)),
        el('div', { class: 'kv' },
          el('span', {}, 'Last activity'),
          el('b', {}, axis.lastActivity ? `${axis.lastActivity} (${daysBetween(axis.lastActivity, day)}d ago)` : 'never')),
      ),
      axis.derived && el('p', { class: 'muted' },
        'Potential is derived, not trained. It reads your streaks, your 30-day consistency, and your goal momentum. No task feeds it. It answers one question: how hard are you compounding right now?'),
      !axis.derived && top.length > 0 && panel({},
        el('div', { class: 'label', style: { marginBottom: '8px' } }, 'Top contributors'),
        ...top.map(([name, pts]) => el('div', { class: 'kv' },
          el('span', {}, name), el('b', {}, pts.toFixed(1)))),
      ),
      axis.stale && !axis.derived && el('p', { class: 'muted', style: { color: 'var(--sys-dim)' } },
        'Untouched for 14+ days. The axis is dimmed, not reduced — you keep what you earned.'),
    );
  });
}

let win = 'ALL';

export async function render(root, ctx) {
  clear(root);
  const settings = store.getSettings();
  const day = store.today();
  const derived = store.getDerived();
  const completions = await store.allCompletions();
  const live = completions.filter((c) => !c.revoked);

  const potentialInputs = {
    journalStreak: derived?.journalStreak || 0,
    logStreak: derived?.logStreak || 0,
    daysLogged30: derived?.daysLogged30 || 0,
    milestones30: 0,
  };

  const axesFor = (w) => computeRadar(completions, {
    rolloverHour: settings.dayRolloverHour, win: w, potentialInputs,
  });

  /* Header block */
  root.append(panel({ class: 'panel gold' },
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '16px' } },
      el('div', {},
        el('div', { class: 'label' }, 'Level'),
        el('div', { class: 'level-big' }, String(derived?.level ?? 1))),
      el('div', { style: { flex: 1 } },
        el('div', { class: 'kv' }, el('span', {}, 'Into level'),
          el('b', { style: { color: 'var(--gold)' } }, `${derived?.into ?? 0} / ${derived?.needed ?? 100}`)),
        el('div', { class: 'kv' }, el('span', {}, 'Total XP'), el('b', {}, String(derived?.totalXp ?? 0))),
        el('div', { class: 'kv' }, el('span', {}, 'Streak'),
          el('b', {}, `${derived?.logStreak ?? 0} d (best ${derived?.logBest ?? 0})`)),
      ),
    ),
  ));

  /* Radar */
  const seg = el('div', { class: 'seg' }, ...WINDOWS.map((w) => {
    const b = el('button', { 'aria-pressed': String(w === win) }, w);
    b.addEventListener('click', () => {
      win = w;
      [...seg.children].forEach((c, i) => c.setAttribute('aria-pressed', String(WINDOWS[i] === win)));
      chart.setValues(axesFor(win));
      caption.textContent = win === 'ALL'
        ? 'Character sheet: 70% lifetime, 30% last 30 days.'
        : `Shape of the last ${win === 'W' ? '7 days' : win === 'M' ? '30 days' : 'year'} — relative activity, not lifetime.`;
    });
    return b;
  }));

  const holder = el('div', { style: { padding: '20px 8px 4px' } });
  const caption = el('p', { class: 'muted', style: { fontSize: '12px', textAlign: 'center' } },
    'Character sheet: 70% lifetime, 30% last 30 days.');

  const radarPanel = panel({}, seg, holder, caption);
  root.append(radarPanel);

  const axes = axesFor(win);
  const chart = createRadar(holder, axes, (a) => statSheet(a, completions, day));

  if (!live.length) {
    clear(holder);
    holder.append(el('div', { class: 'empty' }, 'Insufficient data.\nAct, and the chart follows.'));
  }

  /* XP per day for the window */
  const start = win === 'ALL'
    ? (live.length ? live.map((c) => c.date).sort()[0] : day)
    : windowStart(day, win);
  const span = dayRange(start, day).slice(-90); // cap the strip at 90 bars; beyond that it's mush
  const perDay = {};
  live.forEach((c) => { perDay[c.date] = (perDay[c.date] || 0) + c.xp; });
  const max = Math.max(1, ...span.map((d) => perDay[d] || 0));

  root.append(panel({},
    el('div', { class: 'panel-title' },
      el('span', { class: 'label' }, 'XP per day'),
      el('span', { class: 'label' }, `peak ${max}`)),
    el('div', { class: 'bars' }, ...span.map((d) => {
      const v = perDay[d] || 0;
      const bar = el('i', { class: v >= max * 0.8 && v > 0 ? 'hot' : '', title: `${d}: ${v} XP` });
      bar.style.height = `${Math.max(1, (v / max) * 100)}%`;
      return bar;
    })),
  ));

  /* Most fed / most starved */
  const trainable = axes.filter((a) => a.id !== 'potential');
  const fed = [...trainable].sort((a, b) => b.points30 - a.points30)[0];
  const starved = [...trainable].sort((a, b) => a.points30 - b.points30)[0];
  if (fed && live.length) {
    root.append(panel({},
      el('div', { class: 'kv' },
        el('span', { class: 'label' }, 'Most fed'),
        el('b', { style: { color: 'var(--ok)' } }, `${fed.glyph} ${fed.name}`)),
      el('div', { class: 'kv' },
        el('span', { class: 'label' }, 'Most starved'),
        el('b', { style: { color: 'var(--warn)' } }, `${starved.glyph} ${starved.name}`)),
    ));
  }

  /* Weekly review */
  if (settings.aiEnabled) {
    const rc = el('div');
    root.append(rc);
    renderReviewCard(rc, 'weekly', isoWeekKey(day));
  }
}
