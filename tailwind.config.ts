import type { Config } from 'tailwindcss';
import { ROLES } from './src/lib/m3/scheme';
import { TYPE_SCALE, SHAPE, ELEVATION, LEGACY_ALIASES } from './src/lib/m3/tokens';

// Every color is an M3 role token (src/styles/tokens.css, ADR 0009):
// bg-primary, text-on-surface-variant, border-outline-variant, bg-primary/10 …
const rgb = (role: string) => `rgb(var(--md-sys-color-${role}-rgb) / <alpha-value>)`;
const colors: Record<string, string> = Object.fromEntries(ROLES.map((r) => [r, rgb(r)]));
// Pre-M3 names (bg-bg, text-ink, border-line, bg-accent …) — deprecated
// aliases so un-migrated pages keep following the theme.
for (const [old, role] of Object.entries(LEGACY_ALIASES)) if (!(old in colors)) colors[old] = rgb(role);

// Type scale classes: text-display-large … text-label-small.
const fontSize = Object.fromEntries(Object.keys(TYPE_SCALE).map((k) => {
  const p = `var(--md-sys-typescale-${k}`;
  return [k, [`${p}-size)`, { lineHeight: `${p}-line-height)`, fontWeight: `${p}-weight)`, letterSpacing: `${p}-tracking)` }]];
})) as Record<string, [string, { lineHeight: string; fontWeight: string; letterSpacing: string }]>;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors,
      fontSize,
      borderRadius: {
        token: 'var(--radius)',
        ...Object.fromEntries(Object.keys(SHAPE).map((k) => [`shape-${k}`, `var(--md-sys-shape-corner-${k})`])),
      },
      boxShadow: Object.fromEntries(ELEVATION.map((_, i) => [`elevation-${i}`, `var(--md-sys-elevation-level${i})`])),
      minHeight: { touch: '48px' },
      minWidth: { touch: '48px' },
      opacity: { 38: '0.38', 12: '0.12' },
    },
  },
  plugins: [],
} satisfies Config;
