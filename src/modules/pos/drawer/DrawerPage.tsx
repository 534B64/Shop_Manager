// /pos/drawer — open the drawer, watch the live session, close it (manager+), history.
import { useState } from 'react';
import { Button, Card, CardHeader, EmptyState, LinearProgress } from '../../../components/m3';
import { useQuery } from '../../../lib/query';
import { hasRole } from '../../../lib/session';
import { formatCents } from '../../../lib/format';
import PosHeader from '../PosHeader';
import { formatWhen } from '../lib/when';
import type { DrawerView } from '../types';
import OpenDrawerForm from './OpenDrawerForm';
import CloseDrawerForm from './CloseDrawerForm';
import ZReportView from './ZReportView';
import DrawerHistory from './DrawerHistory';

export default function DrawerPage() {
  const q = useQuery<{ drawer: DrawerView | null }>('/api/drawer/current');
  const [historyKey, setHistoryKey] = useState(0);
  const refresh = () => { q.reload(); setHistoryKey((k) => k + 1); };
  const d = q.data?.drawer;
  const manager = hasRole('manager');

  return (
    <div>
      <PosHeader title="Cash drawer" subtitle="Count the float to open; count the cash to close. Closing freezes the Z-report." />
      <div className="h-1 mb-2">{q.loading && <LinearProgress label="Loading the drawer" />}</div>
      {q.error && <EmptyState tone="error" icon="warning" title="Couldn’t load the drawer"
        action={<Button variant="outlined" touch onClick={q.reload}>Try again</Button>}>{q.error}</EmptyState>}

      {q.data && !d && (
        <Card variant="outlined" className="max-w-md mb-6" aria-labelledby="open-title">
          <CardHeader id="open-title" title="Drawer is closed" subtitle="Cash sales and cash refunds are refused until it’s open." />
          <OpenDrawerForm onOpened={refresh} />
        </Card>
      )}

      {d && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px] items-start mb-6">
          <Card variant="outlined" aria-labelledby="live-title">
            <CardHeader id="live-title" title={`Drawer #${d.id} — open`}
              subtitle={`Opened ${formatWhen(d.openedAt)} by ${d.openedByName ?? '—'} · float ${formatCents(d.openingFloatCents)}${d.openNote ? ` · “${d.openNote}”` : ''}`}
              action={<Button variant="text" touch onClick={q.reload}>Refresh</Button>} />
            <p className="text-body-medium text-on-surface-variant mb-3">Live totals so far (not final until the drawer is closed).</p>
            <ZReportView z={d.zReport} />
          </Card>
          <Card variant="outlined" aria-labelledby="close-title">
            <CardHeader id="close-title" title="Close the drawer" />
            {manager ? <CloseDrawerForm drawer={d} onClosed={refresh} />
              : <p className="text-body-large text-on-surface-variant">A manager closes the drawer (counts the cash and signs off the over/short). Ask a manager to sign in.</p>}
          </Card>
        </div>
      )}

      <h2 className="text-title-large mb-2">History</h2>
      <DrawerHistory key={historyKey} />
    </div>
  );
}
