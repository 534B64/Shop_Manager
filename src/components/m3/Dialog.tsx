import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Where Tab should go inside a trap, or null to let the browser move normally.
 * `inside` = focus is currently within the trapped element; when it isn't (it
 * escaped, e.g. to the page behind), Tab brings it back to the first/last item.
 */
export function nextTrapFocus<T>(items: T[], current: T | null, shift: boolean, inside: boolean): T | null {
  if (items.length === 0) return null;
  const [a, z] = [items[0], items[items.length - 1]];
  if (!inside) return shift ? z : a;
  if (shift && current === a) return z;
  if (!shift && current === z) return a;
  return null;
}

// Open traps, innermost last: only the top one handles keys.
const openTraps: HTMLElement[] = [];

/** Keep Tab inside `el` (listening on the whole document, so focus can't
 *  escape to the page behind); Escape calls onEscape. Restores focus on close. */
export function useFocusTrap(el: React.RefObject<HTMLElement>, active: boolean, onEscape?: () => void) {
  const escRef = useRef(onEscape);
  escRef.current = onEscape;
  useEffect(() => {
    if (!active || !el.current) return;
    const root = el.current;
    const before = document.activeElement as HTMLElement | null;
    const first = root.querySelector<HTMLElement>('[autofocus],[data-autofocus]') ?? root.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? root).focus();
    openTraps.push(root);
    const onKey = (e: KeyboardEvent) => {
      if (openTraps[openTraps.length - 1] !== root) return;
      if (e.key === 'Escape' && escRef.current) { e.stopPropagation(); escRef.current(); return; }
      if (e.key !== 'Tab') return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      const current = document.activeElement as HTMLElement | null;
      const inside = !!current && root.contains(current);
      const next = nextTrapFocus(items, current, e.shiftKey, inside);
      if (items.length === 0) { e.preventDefault(); root.focus(); return; }
      if (next) { e.preventDefault(); next.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      openTraps.splice(openTraps.indexOf(root), 1);
      before?.focus?.();
    };
  }, [active, el]);
}

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  /** Buttons, right-aligned (M3: text buttons, confirming action last). */
  actions?: ReactNode;
  /** Short description under the title, announced with it. */
  description?: ReactNode;
  className?: string;
  /** Clicking the scrim closes (default true). Off for forms that would lose input. */
  dismissOnScrim?: boolean;
}

/** M3 basic dialog: modal, focus-trapped, Escape and scrim close. */
export default function Dialog({ open, onClose, title, description, children, actions, className, dismissOnScrim = true }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useFocusTrap(ref, open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-scrim/40 app-chrome"
      onMouseDown={(e) => { if (dismissOnScrim && e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={description ? `${id}-d` : undefined}
        tabIndex={-1}
        className={cx('w-full max-w-md max-h-[90vh] overflow-auto rounded-shape-extra-large bg-surface-container-high text-on-surface shadow-elevation-3 p-6 outline-none', className)}>
        <h2 id={`${id}-t`} className="text-headline-small mb-4">{title}</h2>
        {description && <p id={`${id}-d`} className="text-body-medium text-on-surface-variant mb-4">{description}</p>}
        {children}
        {actions && <div className="flex flex-wrap justify-end gap-2 mt-6">{actions}</div>}
      </div>
    </div>,
    document.body,
  );
}
