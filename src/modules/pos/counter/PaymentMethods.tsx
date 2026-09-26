import { cx } from '../../../components/m3';

export const SALE_METHODS = ['cash', 'card', 'check', 'other'] as const;
export type SaleMethod = (typeof SALE_METHODS)[number];
const LABELS: Record<SaleMethod, string> = { cash: 'Cash', card: 'Card', check: 'Check', other: 'Other' };

/** Big tender buttons (64px): one tap picks how the customer pays. */
export default function PaymentMethods({ value, onChange, methods = SALE_METHODS, labels = LABELS }: {
  value: string; onChange: (m: string) => void; methods?: readonly string[]; labels?: Record<string, string>;
}) {
  return (
    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Payment method">
      {methods.map((m) => {
        const on = value === m;
        return (
          <button key={m} type="button" aria-pressed={on} onClick={() => onChange(m)}
            className={cx('state-layer h-16 rounded-shape-medium text-title-large',
              on ? 'bg-primary text-on-primary shadow-elevation-1' : 'border border-outline text-on-surface')}>
            {labels[m] ?? m}
          </button>
        );
      })}
    </div>
  );
}
