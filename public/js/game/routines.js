// routines.js — fixed daily routine quests and their Eastern-time unlock schedule.
// "Eastern" intentionally uses the IANA zone so 8 PM stays 8 PM through daylight saving time.

export const ROUTINE_TIME_ZONE = 'America/New_York';

export const ROUTINES = [
  {
    id: 'morning',
    name: 'Morning Quest',
    glyph: '☀',
    unlockHour: 0,
    bonusXp: 35,
    notice: 'NO SCREEN-TIME DURING THIS',
    statWeights: { health: 0.7, discipline: 0.7 },
    steps: [
      { id: 'make-bed', name: 'Make the bed' },
      { id: 'meditate', name: '5-minute meditation' },
      { id: 'drink-water', name: 'Drink a glass of water' },
      { id: 'bathroom-wash-face', name: 'Go to bathroom + wash face with cold water' },
      { id: 'go-outside', name: 'Go outside for 5 minutes' },
      { id: 'supplements', name: 'Take supplements' },
      { id: 'clean-breakfast', name: 'Eat a clean breakfast' },
    ],
  },
  {
    id: 'night',
    name: 'Night Quest',
    glyph: '☾',
    unlockHour: 20,
    bonusXp: 35,
    notice: 'UNLOCKS DAILY AT 8:00 PM ET',
    statWeights: { health: 0.7, discipline: 0.7 },
    steps: [
      { id: 'screens-off', name: 'No more screen time' },
      { id: 'shower-teeth', name: '9:00 PM → Shower + brush teeth' },
      { id: 'wind-down', name: '9:20 PM → Read / journal / meditate / stretch' },
      { id: 'in-bed', name: 'In bed by 9:45 PM' },
    ],
  },
];

const easternFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ROUTINE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Calendar date and wall-clock time in New York for an absolute moment. */
export function easternClock(now = new Date()) {
  const parts = Object.fromEntries(easternFormatter.formatToParts(now)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)]));
  return {
    day: `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

export function availableRoutines(now = new Date()) {
  const clock = easternClock(now);
  return ROUTINES.filter((routine) => clock.hour >= routine.unlockHour);
}

/** Changes at Eastern midnight and again when the Night Quest unlocks. */
export function routineMomentKey(now = new Date()) {
  const clock = easternClock(now);
  return `${clock.day}:${clock.hour >= 20 ? 'night' : 'morning'}`;
}

export const routineById = (id) => ROUTINES.find((routine) => routine.id === id) || null;
export const routineStepTemplateId = (routineId, stepId) => `routine:${routineId}:step:${stepId}`;
export const routineAwardTemplateId = (routineId) => `routine:${routineId}:complete`;
