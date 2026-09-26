// The paper quote / work ticket. Hidden on screen; index.css shows only this when printing.
import { createPortal } from 'react-dom';
import { formatCents, formatDate } from '../../../lib/format';
import { JOB_TYPE_LABELS } from '../../../../shared/domain';
import { jobTotal, type JobDetail } from '../types';

const cell = 'border border-outline-variant px-2.5 py-1.5 align-top';

export default function PrintSheet({ job }: { job: JobDetail }) {
  const rows: [string, string][] = [
    ['Customer', `${job.customerName ?? '—'}${job.customerPhone ? ` · ${job.customerPhone}` : ''}`],
    ['Job', job.title],
    ['Type', JOB_TYPE_LABELS[job.type as keyof typeof JOB_TYPE_LABELS] ?? job.type],
    ['Size / Qty', `${job.widthIn ?? '—'}″ × ${job.heightIn ?? '—'}″ · qty ${job.quantity}${job.rollWidthIn ? ` · ${job.rollWidthIn}″ roll` : ''}`],
    ['Material', job.materialName ?? '—'],
    ...job.items.map((it, i): [string, string] => [`Line ${i + 2}`, `${it.title} × ${it.qty}${it.widthIn ? ` · ${it.widthIn}″ × ${it.heightIn ?? '—'}″` : ''}`]),
    ['Due date', formatDate(job.dueDate)],
    ['Tags', job.tags || '—'],
    ['Notes', job.notes || '—'],
    ...(job.fileRef ? [['Design file', job.fileRef] as [string, string]] : []),
  ];
  return createPortal(
    <div className="print-sheet" aria-hidden>
      <h1 className="text-headline-small">Decals Plus</h1>
      <p className="mb-4">{job.po ?? `#${job.id}`} — {formatDate(job.createdAt)}{job.createdBy ? ` — by ${job.createdBy}` : ''}
        {job.invoice ? ` — Invoice ${job.invoice.number}` : ''}</p>
      <table className="w-full border-collapse text-body-medium">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}><td className={`${cell} w-32`}>{k}</td><td className={`${cell} whitespace-pre-wrap`}>{v}</td></tr>
          ))}
          <tr>
            <td className={`${cell} font-bold`}>Total{job.taxable ? ' (tax incl.)' : ''}{job.discountPct ? ` (−${job.discountPct}%)` : ''}</td>
            <td className={`${cell} font-bold text-title-large`}>{formatCents(jobTotal(job) ?? 0)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-4 text-body-small">Quote valid 30 days. Thank you for your business!</p>
    </div>,
    document.body,
  );
}
