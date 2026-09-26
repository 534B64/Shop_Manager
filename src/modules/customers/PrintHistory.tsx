import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { STATUS_LABELS } from '../../../shared/domain';
import { formatCents, formatDate } from '../../lib/format';
import { jobsTotal, type CustomerDetail } from './logic';

const cell = 'border border-outline px-2 py-1 text-left';

/** Printable order history ("Save as PDF" from the print dialog). Only the
 *  .print-sheet shows when printing (src/index.css). */
export default function PrintHistory({ customer: c, onDone }: { customer: CustomerDetail; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(() => { window.print(); onDone(); }, 60);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return createPortal(
    <div className="print-sheet">
      <h1 className="text-headline-small">Decals Plus — Order History</h1>
      <p className="text-body-medium mb-3">{c.name}{c.phone ? ` · ${c.phone}` : ''} · printed {new Date().toLocaleDateString()}</p>
      <table className="w-full border-collapse text-body-small">
        <thead>
          <tr>{['Date', 'PO', 'Job', 'Status', 'Price'].map((h) => <th key={h} className={cell}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {c.jobs.map((j) => (
            <tr key={j.id}>
              <td className={cell}>{formatDate(j.createdAt)}</td>
              <td className={cell}>{j.po ?? j.id}</td>
              <td className={cell}>{j.title}</td>
              <td className={cell}>{STATUS_LABELS[j.status as keyof typeof STATUS_LABELS] ?? j.status}</td>
              <td className={cell}>{j.finalPriceCents != null ? formatCents(j.finalPriceCents) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-title-small">Total: {formatCents(jobsTotal(c.jobs))} across {c.jobs.length} jobs</p>
    </div>,
    document.body,
  );
}
