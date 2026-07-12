// journal.js — the editor, the streak strip, the history.
// No push notifications in v1 (Q-4). The only pressure is one line of placeholder text.

import { el, clear, panel, toast } from './dom.js';
import * as store from '../store.js';
import { recentDots, computeStreak } from '../game/streaks.js';
import { addDays } from '../game/dates.js';

const MOODS = ['1', '2', '3', '4', '5'];

/** The one line of pressure the app is allowed to apply. In-app only, and it never scolds. */
function placeholder(entryCount, yesterdayBlank) {
  if (entryCount === 0) return 'Entry 001 starts here.';
  if (yesterdayBlank) {
    return `Day ${entryCount + 1} of your log is blank. The system does not judge. The system does, however, notice.`;
  }
  return 'Log the day.';
}

export async function render(root, ctx) {
  clear(root);
  const day = store.today();
  const settings = store.getSettings();
  const [entry, all] = await Promise.all([store.journalForDay(day), store.allJournal()]);

  const written = all.filter((j) => j.wordCount > 0);
  const journalDays = new Set(written.map((j) => j.date));
  const s = computeStreak(journalDays, { rolloverHour: settings.dayRolloverHour });
  const dots = recentDots(journalDays, s.frozenDays, { rolloverHour: settings.dayRolloverHour });
  const yesterdayBlank = !journalDays.has(addDays(day, -1));

  root.append(el('h1', { class: 'screen' }, 'Log', el('small', { class: 'label' }, day)));

  /* Streak strip */
  root.append(panel({},
    el('div', { class: 'streak-row' },
      el('div', {},
        el('div', { class: 'label' }, 'Streak'),
        el('div', { class: `streak-fig${s.current > 0 ? ' alive' : ''}` }, String(s.current))),
      el('div', {},
        el('div', { class: 'label' }, 'Best'),
        el('div', { class: 'streak-fig' }, String(s.best))),
      el('div', {},
        el('div', { class: 'label' }, 'Freeze'),
        el('div', { class: 'tokens', style: { height: '24px', alignItems: 'center' } },
          ...Array.from({ length: 2 }, (_, i) => el('i', { class: `token${i < s.tokens ? '' : ' spent'}` })))),
    ),
    el('div', { class: 'dots' }, ...dots.map((d) =>
      el('i', { class: `dot ${d.state}`, title: `${d.day} · ${d.state}` }))),
    s.tokens > 0 && el('p', { class: 'muted', style: { marginTop: '10px', fontSize: '12px' } },
      'A freeze token spends itself automatically on a missed day. The streak survives.'),
  ));

  /* Editor */
  const ta = el('textarea', {
    class: 'editor',
    placeholder: placeholder(written.length, yesterdayBlank),
    'aria-label': 'Journal entry',
  });
  ta.value = entry?.text || '';

  const count = el('span', { class: 'label' }, `${entry?.wordCount || 0} words`);
  const status = el('span', { class: 'label', style: { color: 'var(--sys-dim)' } }, entry ? 'Saved' : '');

  let mood = entry?.mood ?? null;
  const moodRow = el('div', { class: 'moods' }, ...MOODS.map((m) => {
    const b = el('button', { class: 'mood', 'aria-pressed': String(mood === +m), 'aria-label': `Mood ${m}` }, m);
    b.addEventListener('click', async () => {
      mood = mood === +m ? null : +m;
      [...moodRow.children].forEach((c, i) => c.setAttribute('aria-pressed', String(mood === i + 1)));
      await store.saveJournal(day, ta.value, mood);
    });
    return b;
  }));

  let timer;
  const save = async () => {
    const before = journalDays.has(day);
    await store.saveJournal(day, ta.value, mood);
    status.textContent = 'Saved';
    count.textContent = `${ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0} words`;
    if (!before && ta.value.trim()) { toast('Streak advanced.'); ctx.refreshHeader(); }
  };

  // Autosave: debounced 800 ms on pause, immediate on blur.
  // Killing the app mid-write loses at most 800 ms of typing.
  ta.addEventListener('input', () => {
    status.textContent = 'Saving…';
    clearTimeout(timer);
    timer = setTimeout(save, 800);
  });
  ta.addEventListener('blur', () => { clearTimeout(timer); save(); });

  root.append(panel({},
    ta,
    el('div', { class: 'editor-foot' }, moodRow, el('div', {}, status, ' ', count)),
  ));

  /* History */
  const search = el('input', { class: 'field', placeholder: 'Search the log…', 'aria-label': 'Search journal' });
  const list = el('div');

  const paint = (q = '') => {
    clear(list);
    const rows = written
      .filter((j) => !q || j.text.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => b.date.localeCompare(a.date));

    if (!rows.length) {
      list.append(el('div', { class: 'empty' }, q ? 'No entries match.' : 'Entry 001 starts here.'));
      return;
    }
    let month = null;
    for (const j of rows) {
      const m = j.date.slice(0, 7);
      if (m !== month) { month = m; list.append(el('div', { class: 'label', style: { marginTop: '16px' } }, m)); }
      list.append(el('div', { class: 'entry' },
        el('div', { class: 'entry-date' }, `${j.date}${j.mood ? ` · mood ${j.mood}` : ''} · ${j.wordCount}w`),
        el('div', { class: 'entry-text' }, j.text.length > 260 ? `${j.text.slice(0, 260)}…` : j.text),
      ));
    }
  };
  search.addEventListener('input', () => paint(search.value));
  paint();

  root.append(panel({},
    el('div', { class: 'panel-title' }, el('span', { class: 'label' }, 'History')),
    search,
    list,
  ));
}
