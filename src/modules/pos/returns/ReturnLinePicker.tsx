import { Button, Switch, cx } from '../../../components/m3';
import { formatCents } from '../../../lib/format';
import type { InvoiceLine } from '../types';
import { canRestock, remainingQty, type ReturnPick } from './plan';

/** One invoice line on the return form: how many come back (≤ what's left), and back on the shelf? */
export default function ReturnLinePicker({ line, pick, valueCents, onChange }: {
  line: InvoiceLine; pick: ReturnPick; valueCents: number; onChange: (p: ReturnPick) => void;
}) {
  const left = remainingQty(line);
  const stock = canRestock(line);
  return (
    <li className={cx('py-3 border-b border-outline-variant last:border-b-0', left === 0 && 'text-on-surface-variant')}>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <p className="flex-1 min-w-0 text-title-medium">{line.lineNo}. {line.description}</p>
        <p className="text-body-medium tabular-nums">{formatCents(line.totalCents)} for {line.qty}</p>
      </div>
      <p className="text-body-small text-on-surface-variant">
        {left === 0 ? 'All returned already' : `${left} of ${line.qty} can still come back`}{line.returnedQty > 0 && left > 0 ? ` (${line.returnedQty} returned before)` : ''}
      </p>
      {left > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2">
          <div className="flex items-center gap-1" role="group" aria-label={`Quantity to return of ${line.description}`}>
            <Button variant="outlined" touch className="!px-0 w-12 !text-title-large" aria-label="One fewer"
              disabled={pick.qty <= 0} onClick={() => onChange({ ...pick, qty: pick.qty - 1 })}>−</Button>
            <span className="w-14 text-center text-title-large tabular-nums" aria-live="polite">{pick.qty}</span>
            <Button variant="outlined" touch className="!px-0 w-12 !text-title-large" aria-label="One more"
              disabled={pick.qty >= left} onClick={() => onChange({ ...pick, qty: pick.qty + 1 })}>+</Button>
            {pick.qty < left && <Button variant="text" touch onClick={() => onChange({ ...pick, qty: left })}>All {left}</Button>}
          </div>
          {stock
            ? <Switch checked={pick.restock} onChange={(restock) => onChange({ ...pick, restock })} label={pick.restock ? 'Back on the shelf' : 'Damaged — stays off the shelf'} />
            : <span className="text-body-medium text-on-surface-variant">Not a stock item — nothing to restock</span>}
          {pick.qty > 0 && <span className="ml-auto text-title-medium tabular-nums">−{formatCents(valueCents)}</span>}
        </div>
      )}
    </li>
  );
}
