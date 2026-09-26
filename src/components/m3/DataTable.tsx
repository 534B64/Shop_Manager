import type { ReactNode } from 'react';
import { cx } from './cx';
import { IconButton } from './Button';
import { EmptyState, LinearProgress } from './Feedback';
import { pageInfo, type Paging } from '../../lib/query';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Cell content; defaults to row[key]. */
  render?: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Tailwind width class, e.g. 'w-32'. */
  width?: string;
  /** Hide below the md breakpoint (tablet portrait / phone). */
  hideOnNarrow?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  /** Caption for screen readers (and the table's accessible name). */
  label: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Shown when there are no rows and nothing is loading. */
  empty?: ReactNode;
  /** Server paging — pass the usePaged() result straight in. */
  paging?: Paging;
  onRowClick?: (row: T) => void;
  className?: string;
}

const align = (a?: 'left' | 'right' | 'center') => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');

/** Dense, readable table with a server-driven pager and empty/error states. */
export default function DataTable<T>({
  columns, rows, rowKey, label, loading, error, onRetry, empty, paging, onRowClick, className,
}: DataTableProps<T>) {
  const narrow = (c: Column<T>) => (c.hideOnNarrow ? 'hidden md:table-cell' : '');
  return (
    <div className={cx('rounded-shape-medium border border-outline-variant bg-surface overflow-hidden', className)}>
      <div className="h-1">{loading && <LinearProgress label={`Loading ${label}`} />}</div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-body-medium" aria-busy={loading || undefined}>
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr className="border-b border-outline-variant">
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cx('h-12 px-4 text-title-small text-on-surface-variant whitespace-nowrap', align(c.align), c.width, narrow(c))}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined}
                // No `state-layer` on a <tr>: its ::before box renders as an extra cell and shifts the row.
                className={cx('border-b border-outline-variant last:border-b-0', onRowClick && 'cursor-pointer hover:bg-on-surface/[0.08]')}>
                {columns.map((c) => (
                  <td key={c.key} className={cx('h-12 px-4 py-2 text-on-surface', align(c.align), narrow(c))}>
                    {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error ? (
        <EmptyState tone="error" icon="warning" title="Couldn’t load this list"
          action={onRetry && <button type="button" className="text-primary text-label-large underline" onClick={onRetry}>Try again</button>}>
          {error}
        </EmptyState>
      ) : rows.length === 0 && !loading && (empty ?? <EmptyState title="Nothing here yet" />)}
      {paging && <Pager paging={paging} />}
    </div>
  );
}

export function Pager({ paging }: { paging: Paging }) {
  const { from, to } = pageInfo(paging.page, paging.pageSize, paging.total);
  return (
    <div className="flex items-center justify-end gap-2 px-2 h-14 border-t border-outline-variant text-body-medium text-on-surface-variant">
      <span aria-live="polite" className="px-2">{from}–{to} of {paging.total.toLocaleString()}</span>
      <IconButton icon="chevronLeft" label="Previous page" disabled={!paging.hasPrev} onClick={paging.prev} touch />
      <IconButton icon="chevronRight" label="Next page" disabled={!paging.hasNext} onClick={paging.next} touch />
    </div>
  );
}
