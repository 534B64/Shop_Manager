import { THEMES, type Theme } from '../../shared/domain';

export interface DashboardPrefs { due: boolean; owed: boolean; low: boolean; }
export interface Prefs {
  theme: Theme; // light | dark | minimal (shown as "High Contrast")
  accent?: string; // chosen accent color — applies to light & dark only
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

export function applyPrefs(p: Prefs) {
  const root = document.documentElement;
  const theme = THEMES.includes(p.theme) ? p.theme : 'light';
  root.dataset.theme = theme;
  // Light & dark honor a chosen accent color; High Contrast (minimal) is fixed.
  if ((theme === 'light' || theme === 'dark') && p.accent) {
    root.style.setProperty('--accent', p.accent);
    root.style.setProperty('--accent-contrast', '#ffffff');
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-contrast');
  }
  localStorage.setItem(KEY, JSON.stringify(p));
}

export function initTheme() {
  applyPrefs(getPrefs());
}
