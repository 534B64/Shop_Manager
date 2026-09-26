// Color math for the Material 3 scheme (ADR 0009). No dependencies.
//
// A "tone" is CIELAB L* (0 = black, 100 = white), exactly as in M3. Because
// WCAG contrast depends only on relative luminance Y, and L* is a function of
// Y, two colors' contrast is fixed by their tones alone — whatever the hue.
// That is what lets any accent a user picks meet AA: the scheme pairs tones,
// and the tone solver below hits the requested L* exactly, reducing chroma
// (never tone) when a hue can't reach it inside the sRGB gamut.
//
// Hue and chroma live in OKLCH, which keeps a hue stable across tones.

export interface Oklch { l: number; c: number; h: number }

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function hexToRgb(hex: string): [number, number, number] {
  let s = hex.trim().replace(/^#/, '');
  if (s.length === 3) s = s.split('').map((ch) => ch + ch).join('');
  if (!/^[0-9a-f]{6}$/i.test(s)) throw new Error(`Not a hex color: ${hex}`);
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
}

export const isHexColor = (s: unknown): s is string =>
  typeof s === 'string' && /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.trim());

const toLinear = (c8: number) => {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number) =>
  255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** Relative luminance Y (WCAG 2.x) of a linear-sRGB triple. */
const luminanceLinear = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return luminanceLinear(r, g, b);
}

/** WCAG contrast ratio of two hex colors (1 – 21). */
export function contrastRatio(a: string, b: string): number {
  const ya = luminance(a), yb = luminance(b);
  return (Math.max(ya, yb) + 0.05) / (Math.min(ya, yb) + 0.05);
}

export const lstarToY = (t: number) => (t > 8 ? ((t + 16) / 116) ** 3 : t / 903.2962962);
export const yToLstar = (y: number) => (y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : 903.2962962 * y);

/** The tone (L*) of a hex color. */
export const toneOf = (hex: string) => yToLstar(luminance(hex));

function oklchToLinear(l: number, c: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h), b = c * Math.sin(h);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3, M = m_ ** 3, S = s_ ** 3;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.hypot(A, B);
  const h = c < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

const EPS = 1e-5;
const inGamut = (rgb: [number, number, number]) => rgb.every((v) => v >= -EPS && v <= 1 + EPS);

/** OKLCH lightness whose luminance is `y` at this hue/chroma (bisection). */
function lightnessForY(y: number, c: number, h: number): number {
  let lo = 0, hi = 1;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    const [r, g, b] = oklchToLinear(mid, c, h);
    if (luminanceLinear(r, g, b) < y) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The sRGB color with tone `tone` (L*), OKLCH hue `h`, and as much of chroma
 * `c` as the gamut allows at that tone.
 */
export function solveTone(h: number, c: number, tone: number): string {
  if (tone <= 0) return '#000000';
  if (tone >= 100) return '#ffffff';
  const y = lstarToY(tone);
  const attempt = (cc: number) => {
    const l = lightnessForY(y, cc, h);
    return oklchToLinear(l, cc, h);
  };
  let rgb = attempt(c);
  if (!inGamut(rgb)) {
    let lo = 0, hi = c;
    rgb = attempt(0);
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      const t = attempt(mid);
      if (inGamut(t)) { lo = mid; rgb = t; } else hi = mid;
    }
  }
  return rgbToHex(rgb.map((v) => fromLinear(clamp01(v))) as [number, number, number]);
}

/** A hue + chroma, evaluated at any tone (cached). */
export class TonalPalette {
  private cache = new Map<number, string>();
  constructor(readonly hue: number, readonly chroma: number) {}
  tone(t: number): string {
    let hex = this.cache.get(t);
    if (!hex) { hex = solveTone(this.hue, this.chroma, t); this.cache.set(t, hex); }
    return hex;
  }
}
