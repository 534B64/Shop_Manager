import { THEMES, type Theme } from '../../shared/domain';
import { DEFAULT_SEED, schemeFor } from './m3/scheme';
import { isHexColor } from './m3/color';
import { schemeVars } from './m3/tokens';

export interface DashboardPrefs { due: boolean; owed: boolean; low: boolean; }
export interface Prefs {
  theme: Theme; // light | dark | minimal (shown as "High Contrast")
  accent?: string; // seed color of this account's M3 scheme (all three themes)
  dashboard?: DashboardPrefs;
}

const KEY = 'dp-prefs';
export const DEFAULT_PREFS: Prefs = { theme: 'light', dashboard: { due: true, owed: true, low: true } };

export function getPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = { ...DEFAULT_PREFS, ...JSON.parse(raw) } as Prefs;
      // 'custom' is no longer a theme (reserved for a future view option) —
      // migrate any saved value to light, keeping the chosen accent.
      if ((p.theme as string) === 'custom') p.theme = 'light';
      return p;
    }
  } catch { /* fresh */ }
  return DEFAULT_PREFS;
}

/** The seed color in effect for these prefs. */
export const seedOf = (p: Prefs): string =>
  (isHexColor(p.accent) ? p.accent : DEFAULT_SEED).toLowerCase();

let applied: Record<string, string> = {};

/**
 * Theme + accent (ADR 0009): data-theme picks the light / dark / high-contrast
 * token block from src/styles/tokens.css; a non-default accent regenerates the
 * M3 scheme from that seed and sets its color roles inline on <html>.
 */
export function applyPrefs(p: Prefs) {
  const root = document.documentElement;
  const theme = THEMES.includes(p.theme) ? p.theme : 'light';
  root.dataset.theme = theme;
  root.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
  for (const k of Object.keys(applied)) root.style.removeProperty(k);
  applied = seedOf(p) === DEFAULT_SEED ? {} : schemeVars(schemeFor(seedOf(p), theme));
  for (const [k, v] of Object.entries(applied)) root.style.setProperty(k, v);
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

export function initTheme() {
  applyPrefs(getPrefs());
}
