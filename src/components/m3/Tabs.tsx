import { useRef, type KeyboardEvent } from 'react';
import { NavLink } from 'react-router-dom';
import { cx } from './cx';

export interface TabItem { label: string; value: string; /** Route tab: renders a link. */ to?: string; end?: boolean }

const tabCls = (on: boolean) => cx(
  'state-layer relative inline-flex items-center justify-center h-12 px-4 text-title-small whitespace-nowrap',
  on ? 'text-primary after:absolute after:bottom-0 after:inset-x-2 after:h-[3px] after:rounded-t-full after:bg-primary' : 'text-on-surface-variant',
);

/**
 * M3 primary tabs. Two modes:
 *  - route tabs (every item has `to`): real links, so back/forward and bookmarks work;
 *  - state tabs (`value` + `onChange`): role="tablist" with arrow-key navigation.
 */
export default function Tabs({ items, value, onChange, label, className }: {
  items: TabItem[]; value?: string; onChange?: (v: string) => void; label: string; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const wrap = cx('flex overflow-x-auto border-b border-outline-variant', className);
  if (items.every((i) => i.to)) {
    return (
      <nav aria-label={label} className={wrap}>
        {items.map((i) => (
          <NavLink key={i.value} to={i.to!} end={i.end} className={({ isActive }) => tabCls(isActive)}>{i.label}</NavLink>
        ))}
      </nav>
    );
  }
  const onKey = (e: KeyboardEvent) => {
    const idx = items.findIndex((i) => i.value === value);
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = items[(idx + step + items.length) % items.length];
    onChange?.(next.value);
    ref.current?.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus();
  };
  return (
    <div ref={ref} role="tablist" aria-label={label} className={wrap} onKeyDown={onKey}>
      {items.map((i) => {
        const on = i.value === value;
        return (
          <button key={i.value} type="button" role="tab" data-value={i.value} aria-selected={on} tabIndex={on ? 0 : -1}
            className={tabCls(on)} onClick={() => onChange?.(i.value)}>{i.label}</button>
        );
      })}
    </div>
  );
}
