// NavigationRail (medium+ widths), NavigationDrawer (modal, compact widths),
// and TopAppBar. The shell decides which to show; items come from src/routes.
import { useRef, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { cx } from './cx';
import Icon, { type IconName } from './Icon';
import { IconButton } from './Button';
import { useFocusTrap } from './Dialog';

export interface NavItem { to: string; label: string; icon: IconName; end?: boolean; badge?: ReactNode }

export function NavigationRail({ items, header, className }: { items: NavItem[]; header?: ReactNode; className?: string }) {
  return (
    <nav aria-label="Main" className={cx('w-20 shrink-0 flex flex-col items-center gap-1 py-3 bg-surface overflow-y-auto', className)}>
      {header && <div className="mb-3">{header}</div>}
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.end}
          className="group flex flex-col items-center gap-1 w-full min-h-14 py-1 text-label-medium text-on-surface-variant aria-[current=page]:text-on-surface">
          {({ isActive }) => (
            <>
              <span className={cx('state-layer relative flex items-center justify-center h-8 w-14 rounded-shape-full',
                isActive ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant')}>
                <Icon name={it.icon} />
                {it.badge && <span className="absolute top-0 right-2">{it.badge}</span>}
              </span>
              <span className={cx('px-1 text-center leading-tight', isActive && 'font-bold')}>{it.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

/** Modal drawer for narrow screens: scrim, focus trap, closes on navigate / Escape. */
export function NavigationDrawer({ open, onClose, items, header }: { open: boolean; onClose: () => void; items: NavItem[]; header?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-scrim/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Main menu"
        className="h-full w-[min(360px,85vw)] bg-surface-container-low rounded-r-shape-large shadow-elevation-1 p-3 overflow-y-auto">
        <div className="flex items-center justify-between pl-4 mb-2">
          {header}
          <IconButton icon="close" label="Close menu" onClick={onClose} touch />
        </div>
        <nav aria-label="Main">
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} onClick={onClose}
              className={({ isActive }) => cx('state-layer flex items-center gap-3 h-14 px-4 rounded-shape-full text-label-large',
                isActive ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface-variant')}>
              <Icon name={it.icon} />
              <span className="flex-1">{it.label}</span>
              {it.badge}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

export function TopAppBar({ title, leading, trailing, className }: { title: ReactNode; leading?: ReactNode; trailing?: ReactNode; className?: string }) {
  return (
    <header className={cx('sticky top-0 z-30 flex items-center gap-1 h-16 px-2 bg-surface', className)}>
      {leading}
      <div className="flex-1 min-w-0 px-2 text-title-large truncate">{title}</div>
      {trailing}
    </header>
  );
}
