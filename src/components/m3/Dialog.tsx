import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Keep Tab inside `el`; Escape calls onEscape. Restores focus on unmount. */
export function useFocusTrap(el: React.RefObject<HTMLElement>, active: boolean, onEscape?: () => void) {
  const escRef = useRef(onEscape);
  escRef.current = onEscape;
  useEffect(() => {
    if (!active || !el.current) return;
    const root = el.current;
    const before = document.activeElement as HTMLElement | null;
    const first = root.querySelector<HTMLElement>('[autofocus],[data-autofocus]') ?? root.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? root).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && escRef.current) { e.stopPropagation(); escRef.current(); return; }
      if (e.key !== 'Tab') return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (items.length === 0) { e.preventDefault(); return; }
      const [a, z] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    root.addEventListener('keydown', onKey);
    return () => { root.removeEventListener('keydown', onKey); before?.focus?.(); };
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
