// growth.js — Dreams and Milestones.
// Progress = checked sub-milestones (§4.3). Manual % invites lying to yourself; linking
// progress to logged tasks conflates ACTIVITY with ACHIEVEMENT (100 gym sessions ≠ 75 kg).
// Linked tasks appear as a passive heatline: evidence, not progress.

import { el, clear, panel, sheet, svg, toast, confirmDialog } from './dom.js';
import * as store from '../store.js';
import { TRAINABLE, statById } from '../game/stats.js';
import { daysBetween } from '../game/dates.js';
import { GOAL_XP_BASE, HORIZON_MULT } from '../game/xp.js';
import { haptic } from './haptics.js';

function ring(pct) {
  const C = 2 * Math.PI * 20;
  const wrap = el('div', { class: 'ring-wrap' });
  const s = svg('svg', { class: 'ring', viewBox: '0 0 46 46' });
  s.append(svg('circle', { class: 'bg', cx: 23, cy: 23, r: 20 }));
  s.append(svg('circle', {
    class: 'fg', cx: 23, cy: 23, r: 20,
    'stroke-dasharray': C,
    'stroke-dashoffset': C * (1 - pct / 100),
  }));
  wrap.append(s, el('div', { class: 'ring-label' }, `${Math.round(pct)}`));
  return wrap;
}

const progressOf = (g) => {
  if (g.milestones?.length) return (g.milestones.filter((m) => m.done).length / g.milestones.length) * 100;
  return g.manualProgress ?? 0;
};

function goalSheet(existing, refresh) {
  sheet(existing ? 'Edit goal' : 'New goal', (close) => {
    let horizon = existing?.horizon || 'milestone';
    let picked = new Set(Object.keys(existing?.statWeights || {}));
    const milestones = (existing?.milestones || []).map((m) => ({ ...m }));

    const title = el('input', { class: 'field', placeholder: 'What are you actually after?', value: existing?.title || '' });

    const horizonRow = el('div', { class: 'seg' }, ...['milestone', 'dream'].map((h) => {
      const b = el('button', { 'aria-pressed': String(horizon === h) },
        h === 'dream' ? `DREAM ×${HORIZON_MULT.dream}` : `MILESTONE ×${HORIZON_MULT.milestone}`);
      b.addEventListener('click', () => {
        horizon = h;
        [...horizonRow.children].forEach((c, i) => c.setAttribute('aria-pressed', String(['milestone', 'dream'][i] === horizon)));
        award.textContent = `Award: ${GOAL_XP_BASE * HORIZON_MULT[horizon]} XP`;
      });
      return b;
    }));
    const award = el('div', { class: 'label', style: { marginTop: '8px', color: 'var(--gold)' } },
      `Award: ${GOAL_XP_BASE * HORIZON_MULT[horizon]} XP`);

    const chipRow = el('div', { class: 'chips' }, ...TRAINABLE.map((id) => {
      const s = statById(id);
      const c = el('button', { class: 'chip', 'aria-pressed': String(picked.has(id)) }, s.glyph, s.name);
      c.addEventListener('click', () => {
        if (picked.has(id)) picked.delete(id);
        else if (picked.size >= 3) { toast('Three stats max.'); return; }
        else picked.add(id);
        c.setAttribute('aria-pressed', String(picked.has(id)));
      });
      return c;
    }));

    const msList = el('div');
    const paintMs = () => {
      clear(msList);
      milestones.forEach((m, i) => msList.append(el('div', { class: 'ms' },
        el('span', { style: { flex: '1' } }, m.title),
        el('button', { class: 'task-del', onClick: () => { milestones.splice(i, 1); paintMs(); } }, '×'),
      )));
      if (!milestones.length) msList.append(el('div', { class: 'empty' }, 'Define the first step.'));
    };
    paintMs();

    const msInput = el('input', { class: 'field', placeholder: 'Add a step…' });
    const addMs = () => {
      const t = msInput.value.trim();
      if (!t) return;
      milestones.push({ id: store.uid(), title: t, done: false, doneAt: null });
      msInput.value = '';
      paintMs();
    };
    msInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addMs(); });

    return el('div', { class: 'stack' },
      el('div', { class: 'panel' },
        el('div', { class: 'label', style: { marginBottom: '8px' } }, 'Goal'), title,
        el('div', { class: 'label', style: { margin: '16px 0 8px' } }, 'Horizon'), horizonRow, award,
      ),
      el('div', { class: 'panel' },
        el('div', { class: 'label', style: { marginBottom: '10px' } }, 'Which stats does it serve'), chipRow,
      ),
      el('div', { class: 'panel' },
        el('div', { class: 'label', style: { marginBottom: '8px' } }, 'Steps'),
        msList,
        el('div', { class: 'btn-row', style: { marginTop: '10px' } },
          msInput, el('button', { class: 'btn ghost small', onClick: addMs }, 'Add step')),
      ),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn ghost', onClick: close }, 'Cancel'),
        el('button', {
          class: 'btn primary',
          onClick: async () => {
            if (!title.value.trim()) { toast('Give it a name.'); return; }
            const statWeights = {};
            [...picked].forEach((id, i) => { statWeights[id] = i === 0 ? 1 : 0.5; });
            await store.saveGoal({
              ...(existing || {}),
              title: title.value, horizon, statWeights, milestones,
            });
            close();
            refresh();
          },
        }, existing ? 'Save changes' : 'Create goal'),
      ),
    );
  });
}

function goalCard(g, heat, refresh) {
  const pct = progressOf(g);
  const done = g.milestones.filter((m) => m.done).length;

  const card = panel({ class: 'panel' },
    el('div', { class: 'goal-head' },
      ring(pct),
      el('div', { style: { flex: '1', minWidth: 0 } },
        el('div', { class: 'label' },
          `${g.horizon.toUpperCase()} · ${Object.keys(g.statWeights).map((id) => statById(id)?.glyph).join(' ')}`),
        el('div', { class: 'quest-name' }, g.title),
        el('div', { class: 'label' }, `${done}/${g.milestones.length} steps · ${g.xpAward} XP on completion`),
      ),
      el('button', { class: 'task-del', 'aria-label': 'Edit goal', onClick: () => goalSheet(g, refresh) }, '⋯'),
    ),
  );

  g.milestones.forEach((m) => {
    card.append(el('button', {
      class: `ms${m.done ? ' done' : ''}`,
      style: { width: '100%' },
      onClick: async () => {
        if (!m.done) haptic('tick');
        await store.toggleMilestone(g.id, m.id);
        refresh();
      },
    },
      el('i', { class: 'ms-box' }),
      el('span', {}, m.title),
    ));
  });

  if (!g.milestones.length) {
    card.append(el('div', { class: 'empty' }, 'Define the first step.'));
  }

  if (heat > 0) {
    card.append(el('div', { class: 'heatline' }, `${heat} linked completions in 30 d`));
  }
  return card;
}

export async function render(root, ctx) {
  clear(root);
  const [goals, completions] = await Promise.all([store.allGoals(), store.allCompletions()]);
  const day = store.today();

  const heatFor = (g) => {
    const ids = new Set(g.linkedTemplateIds || []);
    if (!ids.size) return 0;
    return completions.filter((c) => !c.revoked && ids.has(c.templateId) && daysBetween(c.date, day) <= 30).length;
  };

  root.append(el('div', { class: 'panel-title' },
    el('h1', { class: 'screen', style: { marginBottom: 0 } }, 'Growth'),
    el('button', { class: 'btn primary small', onClick: () => goalSheet(null, ctx.refresh) }, '+ Goal'),
  ));

  const active = goals.filter((g) => g.status === 'active');
  const dreams = active.filter((g) => g.horizon === 'dream');
  const miles = active.filter((g) => g.horizon === 'milestone');
  const achieved = goals.filter((g) => g.status === 'achieved');

  if (!active.length && !achieved.length) {
    root.append(el('div', { class: 'empty' },
      'No direction set. A level without a destination is just a number.'));
  }

  if (dreams.length) {
    root.append(el('div', { class: 'label', style: { margin: '16px 0 8px' } }, 'Dreams'));
    dreams.forEach((g) => root.append(goalCard(g, heatFor(g), ctx.refresh)));
  }
  if (miles.length) {
    root.append(el('div', { class: 'label', style: { margin: '16px 0 8px' } }, 'Milestones'));
    miles.forEach((g) => root.append(goalCard(g, heatFor(g), ctx.refresh)));
  }

  if (achieved.length) {
    const hall = panel({ class: 'panel gold' },
      el('div', { class: 'panel-title' },
        el('span', { class: 'label', style: { color: 'var(--gold)' } }, 'Hall of Records'),
        el('span', { class: 'label' }, String(achieved.length))),
    );
    achieved.forEach((g) => hall.append(el('div', { class: 'kv' },
      el('span', {}, g.title),
      el('b', { style: { color: 'var(--gold)' } }, `+${g.xpAward}`))));
    root.append(hall);
  }
}
