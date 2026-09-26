import { Icon, cx } from '../../../components/m3';
import { stockStatus } from '../logic';

/** Stock status as icon + word (never color alone). */
export default function StockStatus({ count, min, className }: { count: number; min: number; className?: string }) {
  const s = stockStatus(count, min);
  if (s === 'out') {
    return (
      <span className={cx('inline-flex items-center gap-1 h-7 px-2 rounded-shape-full bg-error-container text-on-error-container text-label-large whitespace-nowrap', className)}>
        <Icon name="close" size={16} />Out
      </span>
    );
  }
  return (
    <span className={cx('inline-flex items-center gap-1 text-label-large whitespace-nowrap', s === 'low' ? 'text-warning' : 'text-success', className)}>
      <Icon name={s === 'low' ? 'warning' : 'check'} size={16} />{s === 'low' ? 'Low' : 'In stock'}
    </span>
  );
}
