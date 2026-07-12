// backup.js — this is not polish. It is the ONLY insurance against R-2 (iOS can evict origin
// storage under disk pressure, and a lost phone loses everything since the last export).
// Ships in Phase 1 for exactly that reason.

import * as db from './db.js';
import * as store from './store.js';

export const SCHEMA_VERSION = 1;

const STORES = ['taskTemplates', 'completions', 'journalEntries', 'goals', 'dailyQuests', 'aiReviews'];

export async function buildExport() {
  const data = {};
  for (const s of STORES) data[s] = await db.all(s);
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    local: {
      profile: store.getProfile(),
      settings: store.getSettings(),
    },
    data,
  };
}

export async function exportToFile() {
  const payload = await buildExport();
  const json = JSON.stringify(payload, null, 2);
  const name = `solo-leveling-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], name, { type: 'application/json' });

  // iOS share sheet → "Save to Files" / iCloud Drive. The cheapest real backup path
  // that doesn't require a backend (§10 R-2).
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Solo Leveling backup' });
      store.markExported();
      return { shared: true };
    } catch (e) {
      if (e.name === 'AbortError') return { shared: false, cancelled: true };
    }
  }

  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  store.markExported();
  return { shared: false };
}

export function summarize(payload) {
  const c = payload.data?.completions || [];
  const dates = c.map((r) => r.date).sort();
  return {
    schemaVersion: payload.schemaVersion,
    exportedAt: payload.exportedAt,
    counts: Object.fromEntries(STORES.map((s) => [s, (payload.data?.[s] || []).length])),
    range: dates.length ? [dates[0], dates[dates.length - 1]] : null,
    totalXp: c.filter((r) => !r.revoked).reduce((s, r) => s + (r.xp || 0), 0),
  };
}

export function validate(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Not a valid backup file.');
  if (payload.schemaVersion == null) throw new Error('Missing schemaVersion — this is not a Solo Leveling backup.');
  if (payload.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`Backup is schema v${payload.schemaVersion}; this app reads v${SCHEMA_VERSION}. Update the app first.`);
  }
  if (!payload.data || typeof payload.data !== 'object') throw new Error('Backup contains no data.');
  return true;
}

/** Destructive by design: replaces everything, then replays the log to rebuild derived state. */
export async function importPayload(payload) {
  validate(payload);
  await db.clearAll();
  for (const s of STORES) {
    const rows = payload.data[s] || [];
    if (rows.length) await db.putAll(s, rows);
  }
  if (payload.local?.profile) store.saveProfile(payload.local.profile);
  if (payload.local?.settings) store.saveSettings(payload.local.settings);
  return store.recomputeDerived();
}

export async function readFile(file) {
  const text = await file.text();
  return JSON.parse(text);
}

/** Nag after 14 days. The badge is on the You tab, and it is not subtle. */
export function exportOverdue() {
  const last = store.getLastExport();
  if (!last) return true;
  return (Date.now() - new Date(last).getTime()) / 86400000 > 14;
}
