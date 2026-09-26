// /pos/drawer/:id — one session's Z-report (frozen once closed) + CSV download.
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Card, CardHeader, EmptyState, LinearProgress, showSnackbar } from '../../../components/m3';
import { download } from '../../../lib/api';
import { useQuery } from '../../../lib/query';
import { formatCents } from '../../../lib/format';
import PosHeader from '../PosHeader';
import { errorText } from '../lib/errors';
import { formatWhen } from '../lib/when';
import type { DrawerView } from '../types';
import ZReportView from './ZReportView';

export default function ZReportPage() {
  const { id } = useParams();
  const q = useQuery<DrawerView>(id && /^\d+$/.test(id) ? `/api/drawer/${id}` : null);
  const [busy, setBusy] = useState(false);
  const d = q.data;

  async function csv() {
    setBusy(true);
    try { await download(`/api/drawer/${id}/z-report.csv`, `z-report-${id}.csv`); }
    catch (e) { showSnackbar(`Download failed: ${errorText(e)}`); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <PosHeader title={`Z-report · drawer #${id}`}
        subtitle={d ? (d.final ? 'Final — frozen when the drawer was closed.' : 'Drawer still open — live preview, not final.') : undefined}
        action={<div className="flex flex-wrap gap-2">
          <Button variant="outlined" touch to="/pos/drawer">All drawers</Button>
          <Button variant="tonal" touch onClick={csv} disabled={busy || !d}>{busy ? 'Downloading…' : 'Download CSV'}</Button>
        </div>} />
      <div className="h-1 mb-2">{q.loading && <LinearProgress label="Loading the Z-report" />}</div>
      {!id || !/^\d+$/.test(id) ? <EmptyState icon="warning" title="Not a drawer number" /> : null}
      {q.error && <EmptyState tone="error" icon="warning" title="Couldn’t load this drawer"
        action={<Button variant="outlined" touch onClick={q.reload}>Try again</Button>}>{q.error}</EmptyState>}
      {d && (
        <>
          <Card variant="filled" className="mb-4">
            <CardHeader title={d.status === 'closed' ? 'Closed' : 'Open'} />
            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-body-large">
              <div><dt className="inline text-on-surface-variant">Opened: </dt><dd className="inline">{formatWhen(d.openedAt)} by {d.openedByName ?? '—'}</dd></div>
              <div><dt className="inline text-on-surface-variant">Float: </dt><dd className="inline tabular-nums">{formatCents(d.openingFloatCents)}</dd></div>
              {d.closedAt && <div><dt className="inline text-on-surface-variant">Closed: </dt><dd className="inline">{formatWhen(d.closedAt)} by {d.closedByName ?? '—'}</dd></div>}
              {d.openNote && <div><dt className="inline text-on-surface-variant">Open note: </dt><dd className="inline">{d.openNote}</dd></div>}
              {d.closeNote && <div><dt className="inline text-on-surface-variant">Close note: </dt><dd className="inline">{d.closeNote}</dd></div>}
            </dl>
          </Card>
          <ZReportView z={d.zReport} />
        </>
      )}
    </div>
  );
}
