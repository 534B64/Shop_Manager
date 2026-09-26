import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cx } from './cx';

export function List({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return <ul aria-label={label} className={cx('py-2', className)}>{children}</ul>;
}

export interface ListItemProps {
  headline: ReactNode;
  supportingText?: ReactNode;
  leading?: ReactNode;
  /** Right side: a value, a status, an icon button. */
  trailing?: ReactNode;
  /** Makes the row a link (whole row is the target). */
  to?: string;
  onClick?: () => void;
  className?: string;
}

/** M3 list item: one-line (56px) or two-line (72px) when `supportingText` is set. */
export function ListItem({ headline, supportingText, leading, trailing, to, onClick, className }: ListItemProps) {
  const body = (
    <>
      {leading && <span className="shrink-0 text-on-surface-variant">{leading}</span>}
      <span className="flex-1 min-w-0">
        <span className="block truncate text-body-large text-on-surface">{headline}</span>
        {supportingText && <span className="block truncate text-body-medium text-on-surface-variant">{supportingText}</span>}
      </span>
      {trailing && <span className="shrink-0 text-label-large text-on-surface-variant">{trailing}</span>}
    </>
  );
  const cls = cx('flex items-center gap-4 w-full px-4 text-left', supportingText ? 'min-h-[72px] py-2' : 'min-h-14 py-2',
    (to || onClick) && 'state-layer', className);
  return (
    <li>
      {to ? <Link to={to} className={cls}>{body}</Link>
        : onClick ? <button type="button" onClick={onClick} className={cls}>{body}</button>
        : <div className={cls}>{body}</div>}
    </li>
  );
}
