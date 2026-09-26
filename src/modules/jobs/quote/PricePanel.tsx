// Suggested vs final price, tax and level discount. The estimator is
// advisory: the Price typed here is what's charged; a price different from
// the suggestion needs a manager's approval when saved (ADR 0007).
import { Button, Checkbox, Icon, TextField } from '../../../components/m3';
import { formatCents } from '../../../lib/format';
import type { QuoteDraft } from './draft';
import type { QuoteMath } from './math';

interface Props {
  draft: QuoteDraft;
  math: QuoteMath;
  taxRate: number;
  levels: Record<string, number>;
  locked: boolean;
  set: <K extends keyof QuoteDraft>(k: K, v: QuoteDraft[K]) => void;
}

export default function PricePanel({ draft, math, taxRate, levels, locked, set }: Props) {
  const level = draft.customer.level;
  const priceBad = draft.finalPrice.trim() !== '' && math.priceCents == null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 rounded-shape-small bg-surface-container px-4 py-3">
        <div>
          <p className="text-body-medium text-on-surface-variant">Suggested</p>
          <p className="text-title-large" aria-live="polite">{math.suggested != null ? formatCents(math.suggested) : '—'}</p>
        </div>
        {!locked && (
          <Button variant="tonal" disabled={math.suggested == null}
            onClick={() => math.suggested != null && set('finalPrice', (math.suggested / 100).toFixed(2))}>Use suggested</Button>
        )}
      </div>
      <TextField label="Price * ($, before tax)" inputMode="decimal" value={draft.finalPrice} placeholder="45.00" disabled={locked}
        className="[&_input]:text-title-large" error={priceBad ? 'Enter dollars and cents, e.g. 45 or 45.00' : null}
        supportingText={locked ? 'Locked by the invoice.' : 'The whole ticket before tax — lines are advisory.'}
        onChange={(e) => set('finalPrice', e.target.value)} />
      {math.override && !locked && (
        <p role="status" className="flex items-start gap-2 rounded-shape-small bg-warning-container text-on-warning-container px-3 py-2 text-body-medium">
          <Icon name="warning" size={18} className="mt-0.5 shrink-0" />
          <span>Differs from the suggested {formatCents(math.suggested!)}. Saving a price override needs a manager’s approval.</span>
        </p>
      )}
      <div className="flex flex-col">
        <Checkbox label={`Tax (${taxRate}%)`} checked={draft.taxable} disabled={locked} onChange={(e) => set('taxable', e.target.checked)} />
        {level > 0 && (
          <Checkbox label={`Level ${level} discount (${levels[String(level)] ?? 0}%)`} checked={draft.applyDiscount} disabled={locked}
            onChange={(e) => set('applyDiscount', e.target.checked)} />
        )}
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-body-medium">
        <dt className="text-on-surface-variant">Subtotal</dt><dd className="text-right">{formatCents(math.priceCents ?? 0)}</dd>
        {draft.taxable && <><dt className="text-on-surface-variant">Tax</dt><dd className="text-right">{formatCents(math.taxCents)}</dd></>}
        {math.discountCents > 0 && <><dt className="text-success">Discount (after tax)</dt><dd className="text-right text-success">−{formatCents(math.discountCents)}</dd></>}
        <dt className="text-title-medium pt-1 border-t border-outline-variant">Total</dt>
        <dd className="text-title-large text-right pt-1 border-t border-outline-variant">{formatCents(math.grandTotal)}</dd>
      </dl>
    </div>
  );
}
