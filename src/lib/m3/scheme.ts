// Material 3 color scheme from one seed color (ADR 0009).
// Palettes are derived from the seed's OKLCH hue/chroma, then each scheme role
// picks a tone. Contrast is set by the tone pairs below, so it holds for any
// seed — see m3.test.ts for the checked pairs.
import { TonalPalette, hexToOklch, isHexColor } from './color';

export const DEFAULT_SEED = '#2456c4';

/** The three themes the app offers (stored value → label "High Contrast"). */
export type SchemeTheme = 'light' | 'dark' | 'minimal';

export const ROLES = [
  'primary', 'on-primary', 'primary-container', 'on-primary-container',
  'secondary', 'on-secondary', 'secondary-container', 'on-secondary-container',
  'tertiary', 'on-tertiary', 'tertiary-container', 'on-tertiary-container',
  'error', 'on-error', 'error-container', 'on-error-container',
  // Not in stock M3: fixed-hue groups for "paid / in stock" and "due / low".
  'success', 'on-success', 'success-container', 'on-success-container',
  'warning', 'on-warning', 'warning-container', 'on-warning-container',
  'surface', 'on-surface', 'surface-variant', 'on-surface-variant',
  'surface-dim', 'surface-bright',
  'surface-container-lowest', 'surface-container-low', 'surface-container',
  'surface-container-high', 'surface-container-highest',
  'inverse-surface', 'inverse-on-surface', 'inverse-primary',
  'outline', 'outline-variant', 'scrim', 'shadow',
] as const;
export type Role = (typeof ROLES)[number];
export type Scheme = Record<Role, string>;

export interface Palettes {
  primary: TonalPalette; secondary: TonalPalette; tertiary: TonalPalette;
  neutral: TonalPalette; neutralVariant: TonalPalette;
  error: TonalPalette; success: TonalPalette; warning: TonalPalette;
}

export function palettesFromSeed(seed: string): Palettes {
  const { c, h } = hexToOklch(isHexColor(seed) ? seed : DEFAULT_SEED);
  const pc = Math.min(c, 0.2);
  return {
    primary: new TonalPalette(h, pc),
    secondary: new TonalPalette(h, pc * 0.35),
    tertiary: new TonalPalette((h + 60) % 360, pc * 0.5),
    neutral: new TonalPalette(h, Math.min(pc * 0.06, 0.008)),
    neutralVariant: new TonalPalette(h, Math.min(pc * 0.18, 0.03)),
    error: new TonalPalette(27, 0.2),
    success: new TonalPalette(150, 0.15),
    warning: new TonalPalette(65, 0.15),
  };
}

/** Accent-group tones: [role, on-role, container, on-container]. */
type GroupTones = [number, number, number, number];
interface ToneMap {
  accent: GroupTones;
  surface: {
    surface: number; onSurface: number; variant: number; onVariant: number;
    dim: number; bright: number; containers: [number, number, number, number, number];
    inverse: number; inverseOn: number; inversePrimary: number; outline: number; outlineVariant: number;
  };
}

const TONES: Record<SchemeTheme, ToneMap> = {
  light: {
    accent: [40, 100, 90, 10],
    surface: {
      surface: 98, onSurface: 10, variant: 90, onVariant: 30, dim: 87, bright: 98,
      containers: [100, 96, 94, 92, 90],
      inverse: 20, inverseOn: 95, inversePrimary: 80, outline: 50, outlineVariant: 80,
    },
  },
  dark: {
    accent: [80, 20, 30, 90],
    surface: {
      surface: 6, onSurface: 90, variant: 30, onVariant: 80, dim: 6, bright: 24,
      containers: [4, 10, 12, 17, 22],
      inverse: 90, inverseOn: 20, inversePrimary: 40, outline: 60, outlineVariant: 30,
    },
  },
  // High contrast: light, pure-white surfaces, near-black text, dark accents —
  // every text pair clears 7:1 (AAA), not just AA.
  minimal: {
    accent: [25, 100, 35, 100],
    surface: {
      surface: 100, onSurface: 0, variant: 90, onVariant: 20, dim: 87, bright: 100,
      containers: [100, 96, 94, 92, 90],
      inverse: 20, inverseOn: 100, inversePrimary: 80, outline: 25, outlineVariant: 40,
    },
  },
};

function group(name: string, p: TonalPalette, t: GroupTones): Record<string, string> {
  return {
    [name]: p.tone(t[0]), [`on-${name}`]: p.tone(t[1]),
    [`${name}-container`]: p.tone(t[2]), [`on-${name}-container`]: p.tone(t[3]),
  };
}

/** Every scheme role for one seed + theme. */
export function schemeFor(seed: string, theme: SchemeTheme): Scheme {
  const p = palettesFromSeed(seed);
  const t = TONES[theme] ?? TONES.light;
  const s = t.surface;
  const n = p.neutral, nv = p.neutralVariant;
  return {
    ...group('primary', p.primary, t.accent),
    ...group('secondary', p.secondary, t.accent),
    ...group('tertiary', p.tertiary, t.accent),
    ...group('error', p.error, t.accent),
    ...group('success', p.success, t.accent),
    ...group('warning', p.warning, t.accent),
    surface: n.tone(s.surface), 'on-surface': n.tone(s.onSurface),
    'surface-variant': nv.tone(s.variant), 'on-surface-variant': nv.tone(s.onVariant),
    'surface-dim': n.tone(s.dim), 'surface-bright': n.tone(s.bright),
    'surface-container-lowest': n.tone(s.containers[0]),
    'surface-container-low': n.tone(s.containers[1]),
    'surface-container': n.tone(s.containers[2]),
    'surface-container-high': n.tone(s.containers[3]),
    'surface-container-highest': n.tone(s.containers[4]),
    'inverse-surface': n.tone(s.inverse), 'inverse-on-surface': n.tone(s.inverseOn),
    'inverse-primary': p.primary.tone(s.inversePrimary),
    outline: nv.tone(s.outline), 'outline-variant': nv.tone(s.outlineVariant),
    scrim: '#000000', shadow: '#000000',
  } as Scheme;
}
