// app.js — boot, router, the header XP bar, day rollover, the reboot screen.

import * as store from './store.js';
import * as db from './db.js';
import { on, emit } from './bus.js';
import { el, sheet, toast } from './ui/dom.js';
import { showLevelUp } from './ui/levelup.js';
import * as today from './ui/today.js';
import * as journal from './ui/journal.js';
import * as growth from './ui/growth.js';
import * as stats from './ui/stats.js';
import * as you from './ui/you.js';

const TABS = { today, journal, growth, stats, you };
let current = 'today';

/* ---------- Header (A2) ---------- */

function refreshHeader() {
  const d = store.getDerived();
  if (!d) return;
  document.querySelector('#levelBadge b').textContent = d.level;
  document.querySelector('#xpInto').textContent = `${d.into} / ${d.needed}`;
  document.querySelector('#xpTotal').textContent = `${d.totalXp} XP`;
  document.querySelector('#xpFill').style.transform = `scaleX(${Math.max(0, Math.min(1, d.ratio))})`;
}

/* ---------- Router (A1) ---------- */

const ctx = {
  refreshHeader,
  refresh: () => renderTab(current),
  go: (tab) => { location.hash = tab; },
};

async function renderTab(tab) {
  const root = document.querySelector(`#view-${tab}`);
  if (!root) return;

  // Only Today owns the quick-add bar; every other tab must clear it.
  if (tab !== 'today') today.teardown();

  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('#nav button').forEach((b) =>
    b.setAttribute('aria-current', String(b.dataset.tab === tab)));

  root.classList.add('active');
  await TABS[tab].render(root, ctx);
  document.querySelector('main.views').scrollTop = 0;
}

function route() {
  const tab = location.hash.replace('#', '') || 'today';
  current = TABS[tab] ? tab : 'today';
  renderTab(current);
}

/* ---------- The reboot screen (§5.5) ---------- */
// Opening the app after a lapse must be the EASY path. The alternative is deletion.

function rebootScreen(missed, derived, onResume) {
  sheet(null, (close) => el('div', { class: 'stack' },
    el('div', { class: 'label', style: { color: 'var(--sys)', letterSpacing: '.3em' } }, 'SYSTEM REBOOT'),
    el('h1', { class: 'screen', style: { marginTop: '8px' } }, `${missed} days offline.`),
    el('div', { class: 'panel' },
      el('div', { class: 'label', style: { marginBottom: '8px' } }, 'What survived'),
      el('div', { class: 'kv' }, el('span', {}, 'Level'), el('b', { style: { color: 'var(--gold)' } }, String(derived.level))),
      el('div', { class: 'kv' }, el('span', {}, 'Total XP'), el('b', {}, String(derived.totalXp))),
      el('div', { class: 'kv' }, el('span', {}, 'Best streak'), el('b', {}, `${derived.logBest} days`)),
      el('div', { class: 'kv' }, el('span', {}, 'Stats'), el('b', {}, 'intact')),
    ),
    el('p', { class: 'muted' },
      'Nothing was taken. Your first completion today carries a +50 XP reboot bonus.'),
    el('button', {
      class: 'btn primary',
      style: { width: '100%', marginTop: '8px' },
      onClick: () => { close(); onResume(); },
    }, 'Resume'),
  ));
}

/* ---------- Boot ---------- */

async function boot() {
  const settings = store.getSettings();
  document.documentElement.dataset.reduceMotion = String(settings.reducedMotionOverride);

  await db.open();
  await store.seedIfFirstLaunch();

  // Ask Safari not to evict us. Best effort; the real insurance is Export (§4.5, R-2).
  db.requestPersistence().catch(() => {});

  const derived = await store.recomputeDerived();
  refreshHeader();

  const { rolled } = store.rollover();
  await store.ensureQuest();

  // Reboot check before anything renders — the pending bonus is granted on the next completion.
  const reboot = await store.maybeRebootBonus();
  if (reboot?.missed >= 3) {
    let granted = false;
    const off = on('xp:gained', async () => {
      if (granted) return;
      granted = true;
      off();
      await reboot.grant();
      toast('+50 XP — welcome back.');
      refreshHeader();
    });
    rebootScreen(reboot.missed, derived, () => {});
  }

  window.addEventListener('hashchange', route);
  document.querySelectorAll('#nav button').forEach((b) =>
    b.addEventListener('click', () => { location.hash = b.dataset.tab; }));

  route();

  /* Bus wiring */
  on('derived:updated', refreshHeader);
  on('xp:gained', () => {
    const track = document.querySelector('#xpTrack');
    track.classList.remove('pulse');
    void track.offsetWidth; // restart the pulse
    track.classList.add('pulse');
  });
  on('level:up', ({ level }) => { showLevelUp(level); refreshHeader(); });
  on('day:cleared', () => toast('Day cleared. +25 XP.'));
  on('goal:achieved', ({ goal }) => toast(`Goal achieved: ${goal.title}`));
  on('quest:completed', () => toast('Quest cleared.'));

  // The day can roll while the app sits open in the background.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    const { rolled: r } = store.rollover();
    if (r) {
      await store.recomputeDerived();
      await store.ensureQuest();
      refreshHeader();
      renderTab(current);
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('SW registration failed', e));
  }
}

boot().catch((err) => {
  console.error(err);
  document.querySelector('main').innerHTML =
    `<div class="empty">SYSTEM FAULT<br><br>${err.message}<br><br>Your data is not lost — it lives in IndexedDB.</div>`;
});
