import { useEffect, useState } from 'react';
import Button from './Button';

// One snackbar at a time, app-wide. Pages call showSnackbar(); <SnackbarHost/>
// is mounted once by AppShell.
interface Snack { id: number; message: string; actionLabel?: string; onAction?: () => void; ms: number }
let listener: ((s: Snack | null) => void) | null = null;
let seq = 0;

export function showSnackbar(message: string, opts: { actionLabel?: string; onAction?: () => void; ms?: number } = {}) {
  listener?.({ id: ++seq, message, ms: opts.ms ?? (opts.actionLabel ? 8000 : 4000), ...opts });
}

export function SnackbarHost() {
  const [snack, setSnack] = useState<Snack | null>(null);
  useEffect(() => { listener = setSnack; return () => { listener = null; }; }, []);
  useEffect(() => {
    if (!snack) return;
    const t = setTimeout(() => setSnack(null), snack.ms);
    return () => clearTimeout(t);
  }, [snack]);
  return (
    <div role="status" aria-live="polite" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] w-[min(560px,calc(100vw-2rem))] pointer-events-none">
      {snack && (
        <div className="pointer-events-auto flex items-center gap-2 min-h-12 pl-4 pr-2 py-1 rounded-shape-extra-small bg-inverse-surface text-inverse-on-surface shadow-elevation-3">
          <span className="flex-1 text-body-medium py-2">{snack.message}</span>
          {snack.actionLabel && (
            <Button variant="text" className="!text-inverse-primary" onClick={() => { snack.onAction?.(); setSnack(null); }}>
              {snack.actionLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
