// bus.js — the entire cross-cutting comms layer. Events: xp:gained, level:up, day:rolled,
// quest:completed, data:changed, streak:tick.
const handlers = new Map();

export function on(event, fn) {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event).add(fn);
  return () => off(event, fn);
}

export function off(event, fn) {
  handlers.get(event)?.delete(fn);
}

export function emit(event, payload) {
  for (const fn of handlers.get(event) || []) {
    try { fn(payload); } catch (err) { console.error(`[bus] ${event} handler failed`, err); }
  }
}
