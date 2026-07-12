// haptics.js — iOS Safari does not support the Vibration API, including installed PWAs.
// So this is a free win on Android/desktop and a silent no-op on iPhone.
// NOTHING in this app's UX may depend on haptic feedback. The glow pulses are the real
// punch channel on iOS. (§7.5)

import { getSettings } from '../store.js';

export const supported = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

const PATTERNS = {
  tick: [10],
  double: [10, 30, 10],
  levelup: [10, 40, 20, 40, 40],
};

export function haptic(pattern = 'tick') {
  if (!supported()) return false;
  if (!getSettings().haptics) return false;
  try { return navigator.vibrate(PATTERNS[pattern] || PATTERNS.tick); }
  catch { return false; }
}
