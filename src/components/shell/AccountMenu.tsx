import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CUSTOM_ACCENTS } from '../../../shared/domain';
import { Badge, Icon, cx, useFocusTrap } from '../m3';
import { sessionUser, signOut, savePrefs, getPrefs } from '../../lib/session';
import { seedOf } from '../../lib/theme';
import { schemeFor } from '../../lib/m3/scheme';

const ROLE_LABEL = { cashier: 'Cashier', manager: 'Manager', admin: 'Admin' } as const;

/** A swatch shows the accent as it becomes primary, with its on-primary check
 *  mark — an AA-tested pair for any accent (src/lib/m3/m3.test.ts). */
const swatchStyle = (accent: string) => {
  const s = schemeFor(accent, 'light');
  return { background: s.primary, color: s['on-primary'] };
};

/** Who's signed in, their role, and their accent (the accent tells accounts apart). */
export default function AccountMenu() {
  const me = sessionUser();
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState(getPrefs);
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, open, () => setOpen(false));
  if (!me) return null;
  const seed = seedOf(prefs);
  const pick = (accent: string) => { const next = { ...prefs, accent }; setPrefs(next); savePrefs(next); };

  return (
    <div className="relative">
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="state-layer flex items-center gap-2 h-12 pl-1 pr-3 rounded-shape-full text-on-surface">
        <span className="flex items-center justify-center h-9 w-9 rounded-shape-full bg-primary text-on-primary text-title-medium" aria-hidden>
          {me.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden sm:block text-left leading-tight">
          <span className="block text-label-large">{me.name}</span>
          <span className="block text-label-small text-on-surface-variant">{ROLE_LABEL[me.role]}</span>
        </span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setOpen(false)} />
          <div ref={panel} role="dialog" aria-label="Account" tabIndex={-1}
            className="absolute right-0 top-14 z-50 w-72 rounded-shape-medium bg-surface-container shadow-elevation-2 py-2 outline-none">
            <div className="px-4 py-2">
              <div className="text-title-medium">{me.name}</div>
              <Badge tone="neutral" className="!h-6 px-2 mt-1 text-label-medium">{ROLE_LABEL[me.role]}</Badge>
            </div>
            <div className="px-4 py-2">
              <div className="text-label-medium text-on-surface-variant mb-1">Accent color</div>
              <div className="flex gap-1" role="radiogroup" aria-label="Accent color">
                {CUSTOM_ACCENTS.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={seed === c} aria-label={`Accent ${c}`} onClick={() => pick(c)}
                    className="state-layer flex items-center justify-center h-12 w-12 rounded-shape-full">
                    <span className={cx('h-8 w-8 rounded-shape-full flex items-center justify-center', seed === c && 'ring-2 ring-offset-2 ring-on-surface ring-offset-surface-container')}
                      style={swatchStyle(c)}>
                      {seed === c && <Icon name="check" size={18} />}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <hr className="my-2 border-outline-variant" />
            <Link to="/settings" onClick={() => setOpen(false)} className="state-layer flex items-center gap-3 h-12 px-4 text-label-large">
              <Icon name="settings" className="text-on-surface-variant" /> Settings &amp; theme
            </Link>
            <button type="button" onClick={async () => { await signOut(); location.assign('/'); }}
              className="state-layer flex items-center gap-3 h-12 px-4 w-full text-label-large">
              <Icon name="logout" className="text-on-surface-variant" /> Switch user
            </button>
          </div>
        </>
      )}
    </div>
  );
}
