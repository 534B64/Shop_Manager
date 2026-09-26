import { useState } from 'react';
import { Button, showSnackbar } from '../../components/m3';
import type { DateRange } from '../../components/DateRangeFields';
import { download } from '../../lib/api';
import { withParams } from '../../lib/query';
import { errorText } from '../../lib/errorText';
import { hasRole } from '../../lib/session';
import { csvName } from './logic';
import ReportCard from './ReportCard';

/** CSV downloads (sent with the session — a plain link can't authenticate). */
export default function ExportsCard({ range }: { range: DateRange }) {
  const [busy, setBusy] = useState<string | null>(null);
  const r = { from: range.from, to: range.to };
  const exports = [
    { key: 'payments', label: 'Payments CSV', blurb: 'Every payment and refund in the range, voided rows marked.',
      url: withParams('/api/reports/payments.csv', r), file: csvName('payments', range.from, range.to) },
    { key: 'jobs', label: 'Jobs CSV', blurb: 'All jobs ever (no date filter): status, customer, suggested and final price.',
      url: '/api/reports/jobs.csv', file: 'jobs.csv' },
    ...(hasRole('admin') ? [{ key: 'audit', label: 'Audit log CSV', blurb: 'Every recorded change in the range (admin).',
      url: withParams('/api/audit.csv', r), file: csvName('audit-log', range.from, range.to) }] : []),
  ];
  async function go(e: typeof exports[number]) {
    setBusy(e.key);
    try { await download(e.url, e.file); showSnackbar(`Downloaded ${e.file}`); }
    catch (err) { showSnackbar(errorText(err, 'Download failed')); }
    finally { setBusy(null); }
  }
  return (
    <ReportCard title="Exports" subtitle="For the books. Opens in Excel or any spreadsheet.">
      <ul className="divide-y divide-outline-variant">
        {exports.map((e) => (
          <li key={e.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <div className="text-title-small">{e.label}</div>
              <div className="text-body-medium text-on-surface-variant">{e.blurb}</div>
            </div>
            <Button variant="tonal" onClick={() => go(e)} disabled={busy !== null}>{busy === e.key ? 'Downloading…' : 'Download'}</Button>
          </li>
        ))}
      </ul>
    </ReportCard>
  );
}
