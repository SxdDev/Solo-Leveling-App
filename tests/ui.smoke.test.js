// UI smoke test. The unit tests never touch the render layer, and a typo in a tab module
// would otherwise only surface on the phone. This boots each tab against a real IndexedDB
// and a jsdom DOM, and asserts the screen actually contains what it should.

import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'https://sl.test/', pretendToBeVisual: true });

const mem = new Map();
globalThis.window = dom.window;
globalThis.document = dom.window.document;
// Node 22 ships a read-only global `navigator`, so it has to be redefined, not assigned.
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
// NB: do NOT alias globalThis.performance to jsdom's — jsdom's Performance.now() delegates
// back to the global, which makes it recurse into itself forever. Node's native one is fine.
dom.window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.Blob = dom.window.Blob;
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
globalThis.crypto ??= (await import('node:crypto')).webcrypto;

const store = await import('../public/js/store.js');
const db = await import('../public/js/db.js');
const today = await import('../public/js/ui/today.js');
const journal = await import('../public/js/ui/journal.js');
const growth = await import('../public/js/ui/growth.js');
const statsUi = await import('../public/js/ui/stats.js');
const you = await import('../public/js/ui/you.js');

const ctx = { refresh: () => {}, refreshHeader: () => {}, go: () => {} };
const root = () => {
  const d = document.createElement('div');
  document.body.append(d);
  return d;
};

test.before(async () => {
  await db.clearAll();
  await store.seedIfFirstLaunch();
  await store.recomputeDerived();
  await store.ensureQuest();
});

test('Today renders the quest, the habits, and the quick-add bar', async () => {
  const r = root();
  await today.render(r, ctx);

  assert.ok(r.querySelector('.quest'), 'the daily quest card is missing');
  assert.ok(r.querySelector('.quest .sigil')?.textContent, 'the quest sigil has no glyph');
  assert.equal(r.querySelectorAll('.task').length, store.STARTER_HABITS.length, 'every starter habit should have a row');
  assert.ok(r.querySelector('.hexbox'), 'no check-off control');
  assert.ok(document.querySelector('.quickadd'), 'the quick-add bar is not pinned');
  assert.ok(r.textContent.includes('Daily tasks'));
});

test('tapping a hex checkbox actually grants XP and marks the row done', async () => {
  const r = root();
  await today.render(r, ctx);

  const before = store.getDerived().totalXp;
  r.querySelector('.task .hexbox').dispatchEvent(new dom.window.Event('click'));
  await new Promise((res) => setTimeout(res, 40));

  const after = store.getDerived().totalXp;
  assert.ok(after > before, `XP did not move (${before} → ${after})`);

  const r2 = root();
  await today.render(r2, ctx);
  assert.ok(r2.querySelector('.task.done'), 'the completed row is not marked done');
  assert.ok(r2.querySelector('.task.done .hexbox[aria-pressed="true"]'), 'checkbox state is not reflected');
});

test('Stats renders the radar with 11 axes and the window control', async () => {
  const r = root();
  await statsUi.render(r, ctx);

  const svg = r.querySelector('svg.radar');
  assert.ok(svg, 'no radar drawn');

  const poly = svg.querySelector('polygon.poly');
  assert.ok(poly, 'no data polygon');
  assert.equal(poly.getAttribute('points').split(' ').length, 11, 'the polygon must have 11 vertices');
  assert.equal(svg.querySelectorAll('line.spoke').length, 11, '11 spokes');
  assert.ok([...svg.querySelectorAll('.axis-label tspan:first-child')].some((n) => n.textContent === 'STATUS'),
    'radar points should be written out by name');

  const seg = r.querySelectorAll('.seg button');
  assert.equal(seg.length, 4, 'W / M / Y / ALL');
  assert.equal([...seg].map((b) => b.textContent).join(''), 'WMYALL');
  assert.ok(r.querySelector('.level-big'), 'the level numeral is missing');
});

test('switching the radar window does not throw and repaints the polygon', async () => {
  const r = root();
  await statsUi.render(r, ctx);
  const poly = r.querySelector('polygon.poly');
  const before = poly.getAttribute('points');

  [...r.querySelectorAll('.seg button')].find((b) => b.textContent === 'W')
    .dispatchEvent(new dom.window.Event('click'));
  await new Promise((res) => setTimeout(res, 600));

  assert.ok(poly.getAttribute('points'), 'the polygon lost its points during the morph');
  assert.equal(poly.getAttribute('points').split(' ').length, 11);
  assert.ok(r.textContent.includes('Shape of the last 7 days'), 'the caption should explain the window');
});

test('Journal renders the editor, the streak strip and 14 dots', async () => {
  const r = root();
  await journal.render(r, ctx);

  assert.ok(r.querySelector('textarea.editor'), 'no editor');
  assert.equal(r.querySelectorAll('.dot').length, 14, 'the strip must show 14 days');
  assert.equal(r.querySelectorAll('.mood').length, 5, 'five mood taps');
  assert.ok(r.querySelector('.dot.pending'), 'today should read as pending, never missed');
  assert.ok(r.textContent.includes('Streak'));
});

test('the blank-day placeholder is the exact line from the plan', async () => {
  const r = root();
  await journal.render(r, ctx);
  const ph = r.querySelector('textarea.editor').getAttribute('placeholder');
  assert.equal(ph, 'Entry 001 starts here.', 'first-ever entry gets the origin line');
});

test('Growth renders its empty state, then a goal with a progress ring', async () => {
  let r = root();
  await growth.render(r, ctx);
  assert.ok(r.textContent.includes('A level without a destination'), 'no empty state');

  await store.saveGoal({
    title: 'Ship OpbrAutobot v2', horizon: 'dream', statWeights: { money: 1, status: 0.5 },
    milestones: [{ id: 'a', title: 'Casual mode', done: true, doneAt: new Date().toISOString() },
                 { id: 'b', title: 'Ship it', done: false }],
  });

  r = root();
  await growth.render(r, ctx);
  assert.ok(r.textContent.includes('Ship OpbrAutobot v2'));
  assert.ok(r.querySelector('.ring'), 'no progress ring');
  assert.equal(r.querySelector('.ring-label').textContent, '50', '1 of 2 steps = 50%');
  assert.equal(r.querySelectorAll('.ms').length, 2);
  assert.ok(r.querySelector('.ms.done'), 'the completed step is not struck through');
});

test('Growth supports daily, weekly, and monthly goal horizons', async () => {
  for (const horizon of ['daily', 'weekly', 'monthly']) {
    await store.saveGoal({ title: `${horizon} target`, horizon, milestones: [] });
  }
  const r = root();
  await growth.render(r, ctx);
  assert.ok(r.textContent.includes('Daily goals'));
  assert.ok(r.textContent.includes('Weekly goals'));
  assert.ok(r.textContent.includes('Monthly goals'));
});

test('You renders backup, settings and the danger zone', async () => {
  const r = root();
  await you.render(r, ctx);
  const t = r.textContent;
  assert.ok(t.includes('Backup'), 'backup must be on this screen — it is the only insurance');
  assert.ok(t.includes('Never exported'), 'a never-exported app should say so plainly');
  assert.ok(t.includes('Day rollover hour'));
  assert.ok(t.includes('Danger zone'));
  assert.ok(r.querySelector('.btn.danger'));
});

test('no view leaks the quick-add bar onto another tab', async () => {
  await today.render(root(), ctx);
  assert.ok(document.querySelector('.quickadd'));
  today.teardown();
  assert.equal(document.querySelector('.quickadd'), null, 'the bar must not follow you to other tabs');
});
