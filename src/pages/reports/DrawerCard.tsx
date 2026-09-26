import { useState } from 'react';
import { Badge, Button, List, ListItem, showSnackbar } from '../../components/m3';
import KeysetPager from '../../components/KeysetPager';
import { download } from '../../lib/api';
import { useKeyset } from '../../lib/keysetPaging';
import { errorText } from '../../lib/errorText';
import { formatCents } from '../../lib/format';
import ReportCard from './ReportCard';

interface Session {
  id: number; status: 'open' | 'closed'; openedAt: string; closedAt: string | null;
  overShortCents: number | null; countedCashCents: number | null; expectedCashCents: number | null;
}
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Cash drawer sessions, newest first, with each Z-report as CSV. */
export default function DrawerCard() {
  const d = useKeyset<Session>('/api/drawer', {}, 10);
  const [busy, setBusy] = useState<number | null>(null);
  async function z(s: Session) {
    setBusy(s.id);
    try { await download(`/api/drawer/${s.id}/z-report.csv`, `z-report-${s.id}.csv`); }
    catch (e) { showSnackbar(errorText(e, 'Download failed')); }
    finally { setBusy(null); }
  }
  return (
    <ReportCard title="Cash drawer" subtitle="Each session’s Z-report (sales by tender, cash counted, over/short)."
      loading={d.loading} error={d.error} onRetry={d.reload} action={<Button variant="text" to="/pos/drawer">Drawer</Button>}>
      {d.rows.length === 0 && !d.loading ? <p className="text-body-medium text-on-surface-variant">No drawer sessions yet.</p> : (
        <List label="Drawer sessions" className="-mx-4 py-0">
          {d.rows.map((s) => (
            <ListItem key={s.id}
              headline={<span className="flex items-center gap-2">Session {s.id}
                {s.status === 'open' && <Badge tone="primary" className="!h-5 px-2">Open</Badge>}</span>}
              supportingText={`${when(s.openedAt)}${s.closedAt ? ` → ${when(s.closedAt)}` : ''}${s.overShortCents != null
                ? ` · ${s.overShortCents === 0 ? 'balanced' : `${s.overShortCents > 0 ? 'over' : 'short'} ${formatCents(Math.abs(s.overShortCents))}`}` : ''}`}
              trailing={<Button variant="text" onClick={() => z(s)} disabled={busy !== null}
                aria-label={`Download Z-report CSV for session ${s.id}`}>{busy === s.id ? '…' : 'Z-report CSV'}</Button>} />
          ))}
        </List>
      )}
      {(d.hasPrev || d.hasNext) && <div className="-mx-4 -mb-4"><KeysetPager paging={d} /></div>}
    </ReportCard>
  );
}
