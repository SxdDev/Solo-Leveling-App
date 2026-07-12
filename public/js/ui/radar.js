// radar.js — 11 spokes, one polygon, gridlines. ~100 lines of SVG.
// A chart library would add 200 KB to the offline cache to draw one shape badly (§2.3).
// This is also the ONE JS-driven animation in the app (A6): vertex interpolation on rAF.

import { svg, clear } from './dom.js';

// SIZE is bigger than the data circle (R) needs — the gap is legroom for the axis name
// labels (up to "Social Skills" / "Relationships"), which extend outward from a single
// label ring instead of the old two-ring glyph+number layout.
const SIZE = 420;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 118;
const LABEL_RATIO = 1.2;
const RINGS = [0.25, 0.5, 0.75, 1];

const reduced = () =>
  // Optional-chained: matchMedia is universal in browsers but absent in test DOMs, and a
  // missing media API should degrade to "animate", never throw and take the chart with it.
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true ||
  document.documentElement.dataset.reduceMotion === 'true';

const point = (i, n, ratio) => {
  const a = (i / n) * Math.PI * 2 - Math.PI / 2; // start at 12 o'clock
  return [CX + Math.cos(a) * R * ratio, CY + Math.sin(a) * R * ratio];
};

const ringPath = (n, ratio) =>
  Array.from({ length: n }, (_, i) => point(i, n, ratio).join(',')).join(' ');

export function createRadar(container, axes, onAxisTap) {
  clear(container);
  const n = axes.length;
  const root = svg('svg', { class: 'radar', viewBox: `0 0 ${SIZE} ${SIZE}`, role: 'img' });

  for (const r of RINGS) root.append(svg('polygon', { class: 'grid', points: ringPath(n, r) }));

  const valueEls = [];

  axes.forEach((a, i) => {
    const [x, y] = point(i, n, 1);
    root.append(svg('line', { class: 'spoke', x1: CX, y1: CY, x2: x, y2: y }));

    const [lx, ly] = point(i, n, LABEL_RATIO);
    const anchor = lx < CX - 4 ? 'end' : lx > CX + 4 ? 'start' : 'middle';
    const label = svg('text', {
      x: lx, y: ly,
      'text-anchor': anchor,
      'dominant-baseline': 'middle',
      class: `axis-label${a.stale ? ' stale' : ''}`,
    });
    const name = svg('tspan', { x: lx, dy: '-0.5em' });
    name.textContent = a.name;
    const value = svg('tspan', { x: lx, dy: '1.15em', class: 'axis-value' });
    value.textContent = Math.round(a.value);
    label.append(name, value);
    root.append(label);
    valueEls.push(value);

    // Generous invisible tap target — small text, fingers are not.
    const hit = svg('circle', { class: 'hit', cx: lx, cy: ly, r: 22 });
    hit.addEventListener('click', () => onAxisTap?.(a));
    root.append(hit);
  });

  const poly = svg('polygon', { class: 'poly', points: ringPath(n, 0.001) });
  root.append(poly);

  const verts = axes.map((a) => {
    const c = svg('circle', { class: `vertex${a.stale ? ' stale' : ''}`, r: a.stale ? 3 : 2.5, cx: CX, cy: CY });
    root.append(c);
    return c;
  });

  container.append(root);

  let current = axes.map(() => 0);
  let frame = null;

  /** Morph old → new. 11 vertices is trivial; 60fps is free. */
  function setValues(next, { animate = true } = {}) {
    const target = next.map((a) => Math.max(0, Math.min(100, a.value)) / 100);
    if (frame) cancelAnimationFrame(frame);

    // Numbers don't need to morph frame-by-frame like the polygon does — just land on the
    // new window's value. Without this, switching W/M/Y/ALL re-shaped the chart but left
    // every axis label showing the number from whichever window was active on page load.
    next.forEach((a, i) => { valueEls[i].textContent = Math.round(a.value); });

    const apply = (vals) => {
      poly.setAttribute('points', vals.map((v, i) => point(i, n, v).join(',')).join(' '));
      vals.forEach((v, i) => {
        const [x, y] = point(i, n, v);
        verts[i].setAttribute('cx', x);
        verts[i].setAttribute('cy', y);
        verts[i].setAttribute('class', `vertex${next[i].stale ? ' stale' : ''}`);
        verts[i].setAttribute('r', next[i].stale ? 3 : 2.5);
      });
    };

    if (!animate || reduced()) { current = target; apply(target); return; }

    const from = current.slice();
    const t0 = performance.now();
    const DUR = 500;
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2); // --e-io

    const step = (t) => {
      const p = Math.min(1, (t - t0) / DUR);
      const e = ease(p);
      const vals = from.map((f, i) => f + (target[i] - f) * e);
      apply(vals);
      if (p < 1) frame = requestAnimationFrame(step);
      else { current = target; frame = null; }
    };
    frame = requestAnimationFrame(step);
  }

  setValues(axes, { animate: true });
  return { setValues, el: root };
}
