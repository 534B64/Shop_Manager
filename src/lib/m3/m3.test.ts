import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { contrastRatio, toneOf, solveTone, hexToOklch } from './color';
import { DEFAULT_SEED, schemeFor, type Role, type SchemeTheme } from './scheme';
import { renderTokensCss } from './tokens';

const THEMES: SchemeTheme[] = ['light', 'dark', 'minimal'];
const SEEDS: Record<string, string> = {
  default: DEFAULT_SEED, red: '#c03232', green: '#178a4c', yellow: '#f5c518', purple: '#6d3bbf',
  gray: '#808080', teal: '#0e8a8a', black: '#000000', white: '#ffffff', neon: '#39ff14',
};

const SURFACES: Role[] = [
  'surface', 'surface-bright', 'surface-dim', 'surface-container-lowest', 'surface-container-low',
  'surface-container', 'surface-container-high', 'surface-container-highest',
];
const TEXT_ON_SURFACES: Role[] = [
  'on-surface', 'on-surface-variant', 'primary', 'secondary', 'tertiary', 'error', 'success', 'warning',
];
const GROUPS = ['primary', 'secondary', 'tertiary', 'error', 'success', 'warning'];

/** Every [foreground, background, min ratio] pairing components use. */
function pairs(theme: SchemeTheme): [Role, Role, number][] {
  const text = theme === 'minimal' ? 7 : 4.5; // HC holds AAA for text
  const out: [Role, Role, number][] = [];
  for (const bg of SURFACES) {
    for (const fg of TEXT_ON_SURFACES) out.push([fg, bg, text]);
    out.push(['outline', bg, 3]);
  }
  for (const g of GROUPS) {
    out.push([`on-${g}` as Role, g as Role, text]);
    out.push([`on-${g}-container` as Role, `${g}-container` as Role, text]);
  }
  out.push(['on-surface-variant', 'surface-variant', text]);
  out.push(['on-surface', 'surface-variant', text]);
  out.push(['inverse-on-surface', 'inverse-surface', text]);
  out.push(['inverse-primary', 'inverse-surface', text]);
  // Tonal/filled buttons and nav indicators sit on surfaces: 3:1 as UI parts.
  out.push(['primary', 'surface-container-low', 3]);
  return out;
}

describe('M3 tone solver', () => {
  it('hits the requested tone for any hue', () => {
    for (const h of [0, 60, 120, 180, 262, 300]) {
      for (const t of [10, 25, 40, 50, 80, 90, 98]) {
        expect(Math.abs(toneOf(solveTone(h, 0.2, t)) - t)).toBeLessThan(0.6);
      }
    }
  });
  it('keeps the default seed as the light primary', () => {
    const p = schemeFor(DEFAULT_SEED, 'light').primary;
    expect(Math.abs(hexToOklch(p).h - hexToOklch(DEFAULT_SEED).h)).toBeLessThan(2);
    expect(Math.abs(toneOf(p) - toneOf(DEFAULT_SEED))).toBeLessThan(1);
  });
});

describe('M3 scheme is stable', () => {
  it('default seed produces the same tokens', () => {
    const light = schemeFor(DEFAULT_SEED, 'light');
    expect(light.primary).toBe('#2557c5');
    expect(light['on-primary']).toBe('#ffffff');
    expect(light.surface).toMatchInlineSnapshot(`"#f6f9ff"`);
    expect(schemeFor(DEFAULT_SEED, 'dark').primary).toMatchInlineSnapshot(`"#aac7ff"`);
    expect(schemeFor(DEFAULT_SEED, 'minimal').primary).toMatchInlineSnapshot(`"#022f9b"`);
  });
  it('bad seed falls back to the default', () => {
    expect(schemeFor('not-a-color', 'light')).toEqual(schemeFor(DEFAULT_SEED, 'light'));
  });
  it('src/styles/tokens.css is up to date (run `npm run tokens`)', () => {
    const file = fs.readFileSync(path.join(__dirname, '..', '..', 'styles', 'tokens.css'), 'utf8');
    expect(file).toBe(renderTokensCss());
  });
});

describe('WCAG AA on every role pair used', () => {
  for (const [name, seed] of Object.entries(SEEDS)) {
    for (const theme of THEMES) {
      it(`${name} ${seed} — ${theme}`, () => {
        const s = schemeFor(seed, theme);
        const fails = pairs(theme)
          .map(([fg, bg, min]) => ({ fg, bg, min, ratio: contrastRatio(s[fg], s[bg]) }))
          .filter((p) => p.ratio < p.min)
          .map((p) => `${p.fg} on ${p.bg}: ${p.ratio.toFixed(2)} < ${p.min}`);
        expect(fails).toEqual([]);
      });
    }
  }
});
