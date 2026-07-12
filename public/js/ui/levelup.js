// levelup.js — A5. The one moment the app allows itself to shout.
// Save the fireworks for this; the day-clear stamp gets a whisper.

import { el } from './dom.js';
import { haptic } from './haptics.js';

const LINES = [
  'The system acknowledges the change.',
  'Thresholds exist to be crossed.',
  'New difficulty unlocked.',
  'You are not who you were.',
];

export function showLevelUp(level) {
  haptic('levelup');
  const card = el('div', { class: 'lu-card' },
    el('div', { class: 'lu-label' }, 'LEVEL UP'),
    el('div', { class: 'lu-num' }, String(level)),
    el('div', { class: 'lu-sub' }, LINES[level % LINES.length]),
  );

  const overlay = el('div', { class: 'levelup', role: 'dialog', 'aria-label': `Level ${level}` }, card);

  // 12 pre-positioned divs, transform-only. No layout thrash.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const dist = 90 + Math.random() * 70;
    const spark = el('div', { class: 'spark' });
    spark.style.setProperty('--dx', `${Math.cos(a) * dist}px`);
    spark.style.setProperty('--dy', `${Math.sin(a) * dist}px`);
    spark.style.animationDelay = `${i * 25}ms`;
    overlay.append(spark);
  }

  const dismiss = () => overlay.remove();
  overlay.addEventListener('click', dismiss);
  document.body.append(overlay);
  setTimeout(dismiss, 2600);
}
