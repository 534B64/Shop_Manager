import { useState } from 'react';
import { Button, Chip, IconButton, TextField } from '../../../components/m3';
import { formatCents, parseDollarsToCents } from '../../../lib/format';
import { isOverride, MAX_QTY, type CartLine } from './cart';
import type { PricedLine } from '../../../../shared/invoice';

const dollars = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2));

/** One cart line: qty stepper, price each, tax toggle, line tax + total. */
export default function CartLineRow({ line, priced, exempt, autoFocusPrice, onQty, onPrice, onTaxable, onDescription, onRemove }: {
  line: CartLine; priced: PricedLine; exempt: boolean; autoFocusPrice: boolean;
  onQty: (n: number) => void; onPrice: (c: number | null) => void; onTaxable: (t: boolean) => void;
  onDescription: (d: string) => void; onRemove: () => void;
}) {
  const [price, setPrice] = useState(dollars(line.unitPriceCents));
  const [qtyText, setQtyText] = useState<string | null>(null);
  const priceBad = price.trim() !== '' && parseDollarsToCents(price) == null;
  const stock = line.inventoryItemId != null;

  return (
    <li className="py-3 border-b border-outline-variant last:border-b-0">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {stock ? (
            <p className="text-title-medium break-words">{line.description}</p>
          ) : (
            <TextField label="Description" value={line.description} maxLength={200}
              onChange={(e) => onDescription(e.target.value)} error={line.description.trim() ? null : 'Required'} />
          )}
          {stock && <p className="text-body-small text-on-surface-variant">From stock{line.onHand != null ? ` · ${line.onHand} on hand` : ''}</p>}
        </div>
        <IconButton icon="close" label={`Remove ${line.description || 'line'}`} touch onClick={onRemove} />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2">
        <div className="flex items-center gap-1" role="group" aria-label={`Quantity of ${line.description}`}>
          <Button variant="outlined" touch className="!px-0 w-12 !text-title-large" aria-label="One fewer"
            disabled={line.qty <= 1} onClick={() => onQty(line.qty - 1)}>−</Button>
          <input aria-label="Quantity" inputMode="numeric" className="h-12 w-16 text-center text-title-large bg-surface-container-highest text-on-surface rounded-shape-small"
            value={qtyText ?? String(line.qty)}
            onChange={(e) => setQtyText(e.target.value.replace(/\D/g, '').slice(0, 4))}
            onBlur={() => { if (qtyText) onQty(Number(qtyText)); setQtyText(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
          <Button variant="outlined" touch className="!px-0 w-12 !text-title-large" aria-label="One more"
            disabled={line.qty >= MAX_QTY} onClick={() => onQty(line.qty + 1)}>+</Button>
        </div>

        <TextField label="Price each $" inputMode="decimal" className="w-36" value={price} autoFocus={autoFocusPrice}
          autoComplete="off" error={priceBad ? 'Not a price' : line.unitPriceCents == null ? 'Enter a price' : null}
          onChange={(e) => { setPrice(e.target.value); onPrice(e.target.value.trim() === '' ? null : parseDollarsToCents(e.target.value)); }} />

        <Chip kind="filter" touch selected={line.taxable && !exempt} disabled={exempt} aria-label={`Charge tax on ${line.description || 'this line'}`}
          onClick={() => onTaxable(!line.taxable)}>Tax</Chip>

        <div className="ml-auto text-right">
          <p className="text-title-large tabular-nums">{formatCents(priced.totalCents)}</p>
          <p className="text-body-small text-on-surface-variant tabular-nums">
            {exempt ? 'no tax (exempt sale)' : line.taxable ? `tax ${formatCents(priced.taxCents)} (${priced.taxRatePct}%)` : 'no tax'}
          </p>
        </div>
      </div>

      {isOverride(line) && (
        <div className="flex flex-wrap items-center gap-2 mt-2 rounded-shape-small px-3 py-2 bg-warning-container text-on-warning-container">
          <p className="flex-1 text-body-medium">
            Suggested {formatCents(line.suggestedUnitPriceCents!)} each — a different price needs a manager when you complete the sale.
          </p>
          <Button variant="elevated" touch onClick={() => { onPrice(line.suggestedUnitPriceCents!); setPrice(dollars(line.suggestedUnitPriceCents!)); }}>
            Use suggested
          </Button>
        </div>
      )}
    </li>
  );
}
