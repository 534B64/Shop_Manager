import { useState } from 'react';
import { THEMES, CUSTOM_ACCENTS, type Theme } from '../../../../shared/domain';
import { Card, CardHeader, Icon, cx } from '../../../components/m3';
import { getPrefs, savePrefs } from '../../../lib/session';
import { seedOf, type Prefs } from '../../../lib/theme';
import { schemeFor, DEFAULT_SEED } from '../../../lib/m3/scheme';

const THEME_LABELS: Record<Theme, string> = { light: 'Light', dark: 'Dark', minimal: 'High Contrast' };
const ACCENTS: readonly string[] = CUSTOM_ACCENTS;

/** Swatch = the accent as it becomes primary, with on-primary for the check (AA pair, m3.test.ts). */
const swatchStyle = (accent: string) => {
  const s = schemeFor(accent, 'light');
  return { background: s.primary, color: s['on-primary'] };
};

/** Theme + accent — saved to the signed-in account, so it follows them to any PC. */
export default function ThemeCard() {
  const [prefs, setPrefs] = useState<Prefs>(getPrefs);
  const seed = seedOf(prefs);
  const save = (next: Prefs) => { setPrefs(next); savePrefs(next); };

  return (
    <Card>
      <CardHeader title="Appearance" subtitle="Saved to your account — it follows you to any PC." />
      <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-shape-full border border-outline overflow-hidden mb-5">
        {THEMES.map((t, i) => {
          const on = prefs.theme === t;
          return (
            <button key={t} type="button" role="radio" aria-checked={on} onClick={() => save({ ...prefs, theme: t })}
              className={cx('state-layer inline-flex items-center gap-2 h-12 px-5 text-label-large',
                i > 0 && 'border-l border-outline',
                on ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface')}>
              {on && <Icon name="check" size={18} />}{THEME_LABELS[t]}
            </button>
          );
        })}
      </div>
      <div className="text-label-large text-on-surface-variant mb-1">Accent color</div>
      <p className="text-body-small text-on-surface-variant mb-2">Your accent tells accounts apart at a glance and colors every theme.</p>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Accent color">
        {ACCENTS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={seed === c}
            aria-label={c === DEFAULT_SEED ? 'Default accent' : `Accent ${c}`} onClick={() => save({ ...prefs, accent: c })}
            className="state-layer flex items-center justify-center h-12 w-12 rounded-shape-full">
            <span style={swatchStyle(c)}
              className={cx('h-8 w-8 rounded-shape-full flex items-center justify-center', seed === c && 'ring-2 ring-offset-2 ring-on-surface ring-offset-surface')}>
              {seed === c && <Icon name="check" size={18} />}
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
}
