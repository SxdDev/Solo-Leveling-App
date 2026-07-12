// today.js — the loop. If this screen isn't fast and satisfying, nothing else matters.

import { el, clear, panel, sheet, toast, flyUp } from './dom.js';
import { haptic } from './haptics.js';
import * as store from '../store.js';
import { STATS, TRAINABLE, statById } from '../game/stats.js';
import * as XP from '../game/xp.js';
import { renderReviewCard } from '../ai/review.js';

let lastUsedStats = ['health'];

const pips = (n, gold = false) =>
  el('span', { class: 'pips' }, ...Array.from({ length: 5 }, (_, i) =>
    el('i', { class: `pip${gold ? ' gold' : ''}${i < n ? ' on' : ''}` })));

const statSummary = (weights) =>
  Object.keys(weights || {}).map((id) => statById(id)?.glyph || '?').join(' ');

const tick = () => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'M4 12.5 L9.5 18 L20 6');
  s.append(p);
  return s;
};

/* ---------- Quest card (§4.1.1) ---------- */

function questCard(quest, refresh, firstView) {
  if (!quest) return null;
  const done = quest.status === 'completed';
  const stat = statById(quest.statId);

  const card = panel({ class: `panel gold quest${done ? ' done' : ''}${firstView && !done ? ' reveal' : ''}` },
    el('div', { class: 'quest-head' },
      el('div', { class: 'sigil' }, stat.glyph),
      el('div', {},
        el('div', { class: 'label' }, `DAILY QUEST · ${stat.name}`),
        el('div', { class: 'quest-name' }, quest.name),
      ),
    ),
    el('p', { class: 'quest-desc' }, quest.description),
    el('div', { class: 'quest-foot' },
      el('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } },
        pips(quest.difficulty, true),
        el('span', { class: 'quest-bonus' }, `+${quest.bonusXp} XP`),
      ),
      done
        ? el('span', { class: 'label', style: { color: 'var(--ok)' } }, 'CLEARED')
        : el('div', { class: 'btn-row' },
            !quest.rerolled && el('button', {
              class: 'btn ghost small',
              onClick: async () => { await store.rerollQuest(); toast('Quest rerolled — one per day.'); refresh(); },
            }, 'Reroll'),
            el('button', {
              class: 'btn reward small',
              onClick: async (e) => {
                haptic('double');
                const row = await store.completeQuest();
                flyUp(e.target.closest('.panel'), row.xp);
                refresh();
              },
            }, 'Accept'),
          ),
    ),
  );
  return card;
}

/* ---------- Task row ---------- */

function taskRow(t, completion, refresh) {
  const done = !!completion;
  const row = el('div', { class: `task${done ? ' done' : ''}` },
    el('button', {
      class: 'hexbox',
      'aria-pressed': String(done),
      'aria-label': done ? `Undo ${t.name}` : `Complete ${t.name}`,
      onClick: async (e) => {
        const box = e.currentTarget;
        if (done) {
          await store.revoke(completion.id);
          refresh();
          return;
        }
        haptic('tick');
        box.classList.add('pop');
        const c = await store.complete({
          templateId: t.id,
          name: t.name,
          difficulty: t.difficulty,
          statWeights: t.statWeights,
        });
        flyUp(row, c.xp);
        await store.checkDayClear();
        setTimeout(refresh, 280);
      },
    }, tick()),

    el('div', { class: 'task-body' },
      el('div', { class: 'task-name' }, t.name),
      el('div', { class: 'task-meta' },
        pips(t.difficulty),
        el('span', { class: 'task-xp' }, `+${done ? completion.xp : XP.baseXp(t.difficulty)}`),
        el('span', { class: 'task-stats' }, statSummary(t.statWeights)),
      ),
    ),

    t.kind === 'habit' && el('button', {
      class: 'task-del',
      'aria-label': `Remove ${t.name}`,
      onClick: async () => { await store.archiveTemplate(t.id); refresh(); },
    }, '×'),
  );
  return row;
}

/* ---------- Quick-add sheet ---------- */

function quickAddSheet(name, refresh) {
  sheet('New task', (close) => {
    let difficulty = 2;
    let picked = new Set(lastUsedStats); // smart default: your last mapping, preselected
    let asHabit = false;

    const pipRow = el('div', { class: 'pips tappable' }, ...Array.from({ length: 5 }, (_, i) => {
      const p = el('button', { class: `pip${i < difficulty ? ' on' : ''}`, 'aria-label': `Difficulty ${i + 1}` });
      p.addEventListener('click', () => {
        difficulty = i + 1;
        [...pipRow.children].forEach((c, j) => c.classList.toggle('on', j < difficulty));
        xpLine.textContent = `+${XP.baseXp(difficulty)} XP`;
      });
      return p;
    }));

    const xpLine = el('span', { class: 'task-xp' }, `+${XP.baseXp(difficulty)} XP`);

    const chipRow = el('div', { class: 'chips' }, ...TRAINABLE.map((id) => {
      const s = statById(id);
      const c = el('button', { class: 'chip', 'aria-pressed': String(picked.has(id)) }, s.glyph, s.name);
      c.addEventListener('click', () => {
        if (picked.has(id)) picked.delete(id);
        else if (picked.size >= 3) { toast('Three stats max — keep it honest.'); return; }
        else picked.add(id);
        c.setAttribute('aria-pressed', String(picked.has(id)));
      });
      return c;
    }));

    const habitToggle = el('button', { class: 'chip', 'aria-pressed': 'false' }, '⟳', 'Save as habit');
    habitToggle.addEventListener('click', () => {
      asHabit = !asHabit;
      habitToggle.setAttribute('aria-pressed', String(asHabit));
    });

    const submit = async () => {
      if (!picked.size) { toast('Pick at least one stat.'); return; }
      const statWeights = {};
      [...picked].forEach((id, i) => { statWeights[id] = i === 0 ? 1.0 : 0.5; });
      lastUsedStats = [...picked];

      const t = await store.saveTemplate({
        name, difficulty, statWeights,
        kind: asHabit ? 'habit' : 'oneoff',
      });
      if (!asHabit) {
        await store.complete({ templateId: t.id, name, difficulty, statWeights });
        haptic('tick');
      }
      close();
      await store.checkDayClear();
      refresh();
    };

    return el('div', { class: 'stack' },
      el('div', { class: 'panel' },
        el('div', { class: 'task-name' }, name),
        el('div', { class: 'panel-title', style: { marginTop: '12px', marginBottom: 0 } },
          el('span', { class: 'label' }, 'Difficulty'), xpLine),
        pipRow,
      ),
      el('div', { class: 'panel' },
        el('div', { class: 'label', style: { marginBottom: '10px' } }, 'Feeds which stats (max 3)'),
        chipRow,
      ),
      el('div', { class: 'btn-row' },
        habitToggle,
      ),
      el('div', { class: 'btn-row', style: { marginTop: '8px' } },
        el('button', { class: 'btn ghost', onClick: close }, 'Cancel'),
        el('button', { class: 'btn primary', onClick: submit }, asHabit ? 'Save habit' : 'Add and complete'),
      ),
    );
  });
}

/* ---------- Render ---------- */

let seenQuestToday = null;

export async function render(root, ctx) {
  clear(root);
  const day = store.today();
  const [templates, completions, quest] = await Promise.all([
    store.activeTemplates(),
    store.completionsForDay(day),
    store.ensureQuest(day),
  ]);
  const live = completions.filter((c) => !c.revoked);
  const byTemplate = new Map(live.filter((c) => c.templateId).map((c) => [c.templateId, c]));

  const firstView = seenQuestToday !== day;
  seenQuestToday = day;

  const habits = templates.filter((t) => t.kind === 'habit');
  const oneoffs = templates.filter((t) => t.kind === 'oneoff' && byTemplate.has(t.id));

  const xpToday = live.reduce((s, c) => s + c.xp, 0);
  const cleared = live.some((c) => c.source === 'bonus' && c.name === 'Day cleared');

  root.append(
    el('h1', { class: 'screen' },
      'Today',
      el('small', { class: 'label' }, `${day} · ${xpToday} XP earned`)),
  );

  const q = questCard(quest, ctx.refresh, firstView);
  if (q) root.append(q);

  // Habits
  const habitPanel = panel({},
    el('div', { class: 'panel-title' },
      el('span', { class: 'label' }, 'Habits'),
      el('span', { class: 'label' }, `${habits.filter((h) => byTemplate.has(h.id)).length}/${habits.length}`)),
  );
  if (!habits.length) {
    habitPanel.append(el('div', { class: 'empty' }, 'No habits yet. Add one below and it will be here tomorrow.'));
  } else {
    // Unchecked first — the work you still owe is what you should see.
    const sorted = [...habits].sort((a, b) => Number(byTemplate.has(a.id)) - Number(byTemplate.has(b.id)));
    sorted.forEach((t) => habitPanel.append(taskRow(t, byTemplate.get(t.id), ctx.refresh)));
  }
  root.append(habitPanel);

  // One-offs
  if (oneoffs.length) {
    const p = panel({},
      el('div', { class: 'panel-title' }, el('span', { class: 'label' }, 'Done today')),
    );
    oneoffs.forEach((t) => p.append(taskRow(t, byTemplate.get(t.id), ctx.refresh)));
    root.append(p);
  }

  if (cleared) {
    root.append(el('div', { class: 'stamp' }, 'DAY CLEARED · +25 XP'));
  }

  // Daily review — an additive panel. It never gates the tab (§6.1).
  if (store.getSettings().aiEnabled) {
    const holder = el('div');
    root.append(holder);
    renderReviewCard(holder, 'daily', day);
  }

  // Quick-add bar, pinned above the nav.
  document.querySelector('.quickadd')?.remove();
  const input = el('input', { class: 'field', placeholder: 'Log something…', 'aria-label': 'Quick add task' });
  const bar = el('div', { class: 'quickadd' },
    input,
    el('button', {
      class: 'btn primary small',
      onClick: () => {
        const name = input.value.trim();
        if (!name) return;
        input.value = '';
        input.blur();
        quickAddSheet(name, ctx.refresh);
      },
    }, 'Add'),
  );
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') bar.querySelector('button').click(); });
  document.body.append(bar);
}

export function teardown() {
  document.querySelector('.quickadd')?.remove();
}
