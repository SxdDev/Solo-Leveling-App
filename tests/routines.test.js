import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUTINES, availableRoutines, easternClock, routineMomentKey,
} from '../public/js/game/routines.js';

test('Morning Quest contains the requested checklist in order', () => {
  const morning = ROUTINES.find((routine) => routine.id === 'morning');
  assert.equal(morning.notice, 'NO SCREEN-TIME DURING THIS');
  assert.deepEqual(morning.steps.map((step) => step.name), [
    'Make the bed',
    '5-minute meditation',
    'Drink a glass of water',
    'Go to bathroom + wash face with cold water',
    'Go outside for 5 minutes',
    'Take supplements',
    'Eat a clean breakfast',
  ]);
});

test('Night Quest contains the requested checklist in order', () => {
  const night = ROUTINES.find((routine) => routine.id === 'night');
  assert.deepEqual(night.steps.map((step) => step.name), [
    'No more screen time',
    '9:00 PM → Shower + brush teeth',
    '9:20 PM → Read / journal / meditate / stretch',
    'In bed by 9:45 PM',
  ]);
});

test('Eastern midnight starts a fresh Morning Quest day during daylight saving time', () => {
  const before = new Date('2026-07-13T03:59:59.000Z'); // 11:59:59 PM EDT
  const after = new Date('2026-07-13T04:00:00.000Z');  // 12:00:00 AM EDT
  assert.equal(easternClock(before).day, '2026-07-12');
  assert.equal(easternClock(after).day, '2026-07-13');
  assert.notEqual(routineMomentKey(before), routineMomentKey(after));
  assert.deepEqual(availableRoutines(after).map((routine) => routine.id), ['morning']);
});

test('Night Quest unlocks at exactly 8 PM Eastern', () => {
  const before = new Date('2026-07-14T23:59:59.000Z'); // 7:59:59 PM EDT
  const atEight = new Date('2026-07-15T00:00:00.000Z'); // 8:00:00 PM EDT
  assert.deepEqual(availableRoutines(before).map((routine) => routine.id), ['morning']);
  assert.deepEqual(availableRoutines(atEight).map((routine) => routine.id), ['morning', 'night']);
});

test('Eastern schedule follows standard time in winter too', () => {
  const atEight = new Date('2026-12-01T01:00:00.000Z'); // 8:00 PM EST
  assert.deepEqual(easternClock(atEight), {
    day: '2026-11-30', hour: 20, minute: 0, second: 0,
  });
  assert.ok(availableRoutines(atEight).some((routine) => routine.id === 'night'));
});
