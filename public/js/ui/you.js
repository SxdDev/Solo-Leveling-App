// you.js — profile, settings, and the backup that keeps R-2 from being fatal.

import { el, clear, panel, sheet, toast, confirmDialog } from './dom.js';
import * as store from '../store.js';
import * as db from '../db.js';
import * as backup from '../backup.js';
import { usageStats } from '../ai/review.js';
import { supported as hapticsSupported } from './haptics.js';

const toggle = (label, value, onChange, hint) => {
  const b = el('button', { class: 'chip', 'aria-pressed': String(value) }, value ? '●' : '○', label);
  b.addEventListener('click', () => {
    const next = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(next));
    b.firstChild.textContent = next ? '●' : '○';
    onChange(next);
  });
  return el('div', { style: { marginBottom: '10px' } }, b,
    hint && el('div', { class: 'muted', style: { fontSize: '12px', marginTop: '4px' } }, hint));
};

export async function render(root, ctx) {
  clear(root);
  const settings = store.getSettings();
  const profile = store.getProfile();
  const derived = store.getDerived();
  const overdue = backup.exportOverdue();

  root.append(el('h1', { class: 'screen' }, 'You',
    el('small', { class: 'label' }, `Level ${derived?.level ?? 1} · ${derived?.totalXp ?? 0} XP`)));

  /* Profile */
  const name = el('input', { class: 'field', value: profile.name || '', placeholder: 'Name' });
  const birth = el('input', { class: 'field', type: 'date', value: profile.birthdate || '' });
  const height = el('input', { class: 'field', type: 'number', value: profile.heightCm || '', placeholder: 'Height (cm)' });
  const weight = el('input', { class: 'field', type: 'number', placeholder: 'Log weight (kg)' });

  const lastWeight = profile.weightLog?.[profile.weightLog.length - 1];

  root.append(panel({},
    el('div', { class: 'label', style: { marginBottom: '8px' } }, 'Profile'),
    el('div', { class: 'stack' },
      name, birth, height,
      el('div', { class: 'btn-row' },
        weight,
        el('button', {
          class: 'btn ghost small',
          onClick: () => {
            const kg = parseFloat(weight.value);
            if (!kg) return;
            const log = [...(store.getProfile().weightLog || []), { date: store.today(), kg }];
            store.saveProfile({ weightLog: log });
            weight.value = '';
            toast('Weight logged.');
            ctx.refresh();
          },
        }, 'Log')),
      lastWeight && el('div', { class: 'label' }, `Last: ${lastWeight.kg} kg on ${lastWeight.date}`),
      el('button', {
        class: 'btn primary small',
        onClick: () => {
          store.saveProfile({
            name: name.value.trim() || 'Player',
            birthdate: birth.value || null,
            heightCm: height.value ? +height.value : null,
          });
          toast('Profile saved.');
        },
      }, 'Save profile'),
    ),
  ));

  /* Backup — first, because it matters most */
  root.append(panel({ class: `panel${overdue ? ' gold' : ''}` },
    el('div', { class: 'panel-title' },
      el('span', { class: 'label' }, 'Backup'),
      overdue && el('span', { class: 'label', style: { color: 'var(--gold)' } }, 'OVERDUE')),
    el('p', { class: 'muted', style: { fontSize: '13px', marginBottom: '12px' } },
      store.getLastExport()
        ? `Last export: ${store.getLastExport().slice(0, 10)}.`
        : 'Never exported. Everything you have lives on this one device.'),
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn primary small',
        onClick: async () => {
          const r = await backup.exportToFile();
          if (!r.cancelled) toast('Backup created.');
          ctx.refresh();
        },
      }, 'Export'),
      el('button', {
        class: 'btn ghost small',
        onClick: () => {
          const input = el('input', { type: 'file', accept: 'application/json' });
          input.addEventListener('change', async () => {
            const file = input.files[0];
            if (!file) return;
            try {
              const payload = await backup.readFile(file);
              backup.validate(payload);
              const s = backup.summarize(payload);
              sheet('Import backup', (close) => el('div', { class: 'stack' },
                el('p', { class: 'muted' }, 'This replaces everything currently in the app. Check the numbers.'),
                panel({},
                  el('div', { class: 'kv' }, el('span', {}, 'Exported'), el('b', {}, s.exportedAt?.slice(0, 10) || '—')),
                  ...Object.entries(s.counts).map(([k, v]) => el('div', { class: 'kv' }, el('span', {}, k), el('b', {}, String(v)))),
                  el('div', { class: 'kv' }, el('span', {}, 'Date range'), el('b', {}, s.range ? s.range.join(' → ') : '—')),
                  el('div', { class: 'kv' }, el('span', {}, 'Total XP'), el('b', { style: { color: 'var(--gold)' } }, String(s.totalXp))),
                ),
                el('div', { class: 'btn-row' },
                  el('button', { class: 'btn ghost', onClick: close }, 'Cancel'),
                  el('button', {
                    class: 'btn danger',
                    onClick: async () => {
                      close();
                      await backup.importPayload(payload);
                      toast('Data restored.');
                      ctx.refreshHeader();
                      ctx.refresh();
                    },
                  }, 'Replace everything'),
                ),
              ));
            } catch (err) {
              toast(err.message);
            }
          });
          input.click();
        },
      }, 'Import'),
    ),
  ));

  /* Settings */
  const rollover = el('input', {
    class: 'field', type: 'number', min: 0, max: 12,
    value: settings.dayRolloverHour,
  });
  rollover.addEventListener('change', () => {
    const h = Math.max(0, Math.min(12, +rollover.value || 0));
    store.saveSettings({ dayRolloverHour: h });
    store.recomputeDerived().then(ctx.refreshHeader);
    toast(`The day now flips at ${String(h).padStart(2, '0')}:00.`);
  });

  root.append(panel({},
    el('div', { class: 'label', style: { marginBottom: '10px' } }, 'Settings'),
    toggle('Haptics', settings.haptics, (v) => store.saveSettings({ haptics: v }),
      hapticsSupported() ? null : 'This device has no vibration support. iOS Safari does not expose it, so this does nothing here.'),
    toggle('AI reviews', settings.aiEnabled, (v) => { store.saveSettings({ aiEnabled: v }); ctx.refresh(); }),
    toggle('Send journal text to AI', settings.sendJournalToAI,
      (v) => store.saveSettings({ sendJournalToAI: v }),
      'Off: the reviewer sees word counts and moods only. On: the daily review also gets the first 400 characters of what you wrote — which means that text leaves your phone.'),
    toggle('Reduce motion', settings.reducedMotionOverride, (v) => {
      store.saveSettings({ reducedMotionOverride: v });
      document.documentElement.dataset.reduceMotion = String(v);
    }),
    el('div', { class: 'label', style: { margin: '14px 0 6px' } }, 'Day rollover hour'),
    rollover,
    el('div', { class: 'muted', style: { fontSize: '12px', marginTop: '4px' } },
      'The app\'s day flips here, not at midnight. A 1 a.m. entry belongs to the night before.'),
  ));

  /* AI usage + storage */
  const usage = await usageStats();
  const est = await db.estimate();
  const persisted = await navigator.storage?.persisted?.().catch(() => false);

  root.append(panel({},
    el('div', { class: 'label', style: { marginBottom: '8px' } }, 'System'),
    el('div', { class: 'kv' }, el('span', {}, 'Reviews this month'), el('b', {}, String(usage.thisMonth))),
    el('div', { class: 'kv' }, el('span', {}, 'Last review'), el('b', {}, usage.last ? usage.last.slice(0, 10) : '—')),
    el('div', { class: 'kv' }, el('span', {}, 'Storage used'),
      el('b', {}, est?.usage ? `${(est.usage / 1048576).toFixed(1)} MB` : '—')),
    el('div', { class: 'kv' }, el('span', {}, 'Eviction protection'),
      el('b', { style: { color: persisted ? 'var(--ok)' : 'var(--warn)' } }, persisted ? 'granted' : 'not granted')),
    !persisted && el('p', { class: 'muted', style: { fontSize: '12px', marginTop: '8px' } },
      'Safari can evict this app\'s storage under disk pressure. Export regularly — that is the real backup.'),
  ));

  /* Danger zone */
  root.append(panel({},
    el('div', { class: 'label', style: { marginBottom: '10px', color: 'var(--warn)' } }, 'Danger zone'),
    el('button', {
      class: 'btn danger small',
      onClick: () => {
        sheet('Wipe all data', (close) => {
          const confirm = el('input', { class: 'field', placeholder: 'Type DELETE' });
          return el('div', { class: 'stack' },
            el('p', { class: 'muted' }, 'Every completion, entry, goal, and review. There is no undo and no server copy. Export first.'),
            confirm,
            el('div', { class: 'btn-row' },
              el('button', { class: 'btn ghost', onClick: close }, 'Cancel'),
              el('button', {
                class: 'btn danger',
                onClick: async () => {
                  if (confirm.value !== 'DELETE') { toast('Type DELETE to confirm.'); return; }
                  await db.clearAll();
                  Object.values(store.LS).forEach((k) => localStorage.removeItem(k));
                  close();
                  location.reload();
                },
              }, 'Wipe everything'),
            ),
          );
        });
      },
    }, 'Wipe all data'),
  ));
}
