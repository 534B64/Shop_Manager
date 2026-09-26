// Advisory stock signal for one line — never blocks the quote.
import { Icon, cx } from '../../../components/m3';
import type { StockResult } from '../../../lib/types';

export default function StockNote({ stock, color }: { stock: StockResult | null; color: string }) {
  if (!stock || stock.state === 'unknown' || !color) return null;
  const tone = stock.state === 'in_stock' ? 'text-success'
    : stock.state === 'suboptimal' ? 'bg-warning-container text-on-warning-container px-3 py-2 rounded-shape-small'
      : 'bg-error-container text-on-error-container px-3 py-2 rounded-shape-small';
  return (
    <p role="status" className={cx('mt-2 flex items-start gap-2 text-body-medium', tone)}>
      <Icon name={stock.state === 'in_stock' ? 'check' : 'warning'} size={18} className="mt-0.5 shrink-0" />
      <span>
        {stock.state === 'in_stock'
          ? `${color} in stock${stock.useWidth ? ` — ${stock.useWidth}″ roll` : ''}.`
          : stock.message ?? (stock.state === 'out_of_stock' ? `${color} is out of stock.` : `${color}: best width is out.`)}
        {stock.state !== 'in_stock' && <span className="block text-body-small">Advisory — you can still save the quote.</span>}
      </span>
    </p>
  );
}
