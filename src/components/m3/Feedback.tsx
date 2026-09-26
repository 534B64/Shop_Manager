// Badge, progress indicators, and the empty/error states lists share.
import type { ReactNode } from 'react';
import { cx } from './cx';
import Icon, { type IconName } from './Icon';

/** Small status badge. No `children` = a 6px dot. */
export function Badge({ children, tone = 'error', className, label }: {
  children?: ReactNode; tone?: 'error' | 'primary' | 'success' | 'warning' | 'neutral'; className?: string; label?: string;
}) {
  const colors = {
    error: 'bg-error text-on-error', primary: 'bg-primary text-on-primary', success: 'bg-success text-on-success',
    warning: 'bg-warning text-on-warning', neutral: 'bg-surface-container-highest text-on-surface-variant',
  }[tone];
  if (children == null) return <span role={label ? 'img' : undefined} aria-label={label} className={cx('inline-block h-1.5 w-1.5 rounded-shape-full', colors, className)} />;
  return <span aria-label={label} className={cx('inline-flex items-center h-4 min-w-4 px-1 rounded-shape-full text-label-small', colors, className)}>{children}</span>;
}

/** Linear progress: indeterminate without `value` (0–1). */
export function LinearProgress({ value, label = 'Loading', className }: { value?: number; label?: string; className?: string }) {
  const det = value != null;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={det ? 0 : undefined} aria-valuemax={det ? 100 : undefined}
      aria-valuenow={det ? Math.round(value! * 100) : undefined}
      className={cx('h-1 w-full overflow-hidden rounded-shape-full bg-secondary-container', className)}>
      <div className="h-full bg-primary rounded-shape-full origin-left"
        style={det ? { width: `${Math.min(1, Math.max(0, value!)) * 100}%` } : { width: '100%', animation: 'm3-indeterminate 1.4s ease-in-out infinite' }} />
    </div>
  );
}

export function CircularProgress({ size = 40, label = 'Loading', className }: { size?: number; label?: string; className?: string }) {
  return (
    <svg role="progressbar" aria-label={label} width={size} height={size} viewBox="0 0 48 48"
      className={cx('text-primary', className)} style={{ animation: 'm3-spin 1s linear infinite' }}>
      <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray="90 200" />
    </svg>
  );
}

/** Empty / error / info block for lists, tables and cards. */
export function EmptyState({ icon = 'inbox', title, children, action, tone = 'neutral' }: {
  icon?: IconName; title: ReactNode; children?: ReactNode; action?: ReactNode; tone?: 'neutral' | 'error';
}) {
  return (
    <div role={tone === 'error' ? 'alert' : undefined} className="flex flex-col items-center text-center gap-2 py-8 px-4">
      <Icon name={icon} size={32} className={tone === 'error' ? 'text-error' : 'text-on-surface-variant'} />
      <p className="text-title-medium">{title}</p>
      {children && <div className="text-body-medium text-on-surface-variant max-w-sm">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
