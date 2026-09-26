import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export type CardVariant = 'elevated' | 'filled' | 'outlined';

const VARIANT: Record<CardVariant, string> = {
  elevated: 'bg-surface-container-low shadow-elevation-1',
  filled: 'bg-surface-container-highest',
  outlined: 'bg-surface border border-outline-variant',
};

export interface CardProps extends HTMLAttributes<HTMLElement> {
  variant?: CardVariant;
  as?: 'div' | 'section' | 'article' | 'li';
  /** Padding; false for edge-to-edge content (tables, lists). */
  padded?: boolean;
}

export default function Card({ variant = 'outlined', as: Tag = 'section', padded = true, className, ...rest }: CardProps) {
  return <Tag className={cx('rounded-shape-medium text-on-surface', VARIANT[variant], padded && 'p-4', className)} {...rest} />;
}

/** Card title row: headline on the left, optional action(s) on the right. */
export function CardHeader({ title, subtitle, action, id }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="min-w-0">
        <h2 id={id} className="text-title-large">{title}</h2>
        {subtitle && <p className="text-body-medium text-on-surface-variant">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0 -mr-2 -mt-1">{action}</div>}
    </div>
  );
}
