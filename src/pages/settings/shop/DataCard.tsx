import { useEffect, useState } from 'react';
import { Badge, Card, CardHeader } from '../../../components/m3';

type Dataset = 'demo' | 'production' | null | 'unknown';

const LABEL: Record<string, { text: string; tone: 'warning' | 'success' | 'neutral'; blurb: string }> = {
  demo: { text: 'Demo data', tone: 'warning', blurb: 'This server runs the practice database. Nothing here is real.' },
  production: { text: 'Production', tone: 'success', blurb: 'This server runs the shop’s real books.' },
  none: { text: 'Unlabeled', tone: 'neutral', blurb: 'This database has no dataset label yet (see docs/adr/0008).' },
  unknown: { text: 'Unknown', tone: 'neutral', blurb: 'Couldn’t reach the server to check.' },
};

/** Which dataset this server runs (GET /api/health, ADR 0008) + where backups are. */
export default function DataCard() {
  const [dataset, setDataset] = useState<Dataset | undefined>();
  useEffect(() => {
    fetch('/api/health').then((r) => (r.ok ? r.json() : null))
      .then((h: { dataset?: Dataset } | null) => setDataset(h ? h.dataset ?? null : 'unknown'))
      .catch(() => setDataset('unknown'));
  }, []);
  const l = dataset === undefined ? null : LABEL[dataset ?? 'none'];
  return (
    <Card>
      <CardHeader title="Data & backups" />
      <p className="text-body-large mb-1" role="status">
        Dataset: {l ? <Badge tone={l.tone} className="!h-6 px-2 align-middle">{l.text}</Badge>
          : <span className="text-on-surface-variant">checking…</span>}
      </p>
      {l && <p className="text-body-medium text-on-surface-variant mb-4">{l.blurb}</p>}
      <h3 className="text-title-medium mb-1">Backups</h3>
      <p className="text-body-medium text-on-surface-variant">
        The server backs itself up every night at 2 AM, checks each copy, and keeps 14 daily and 8 weekly backups
        in <span className="font-mono text-on-surface">data/backups</span> on the NAS, which the NAS copies offsite.
        How to check them and how to restore: <span className="font-mono text-on-surface">docs/BACKUP.md</span> in the
        Shop Manager folder.
      </p>
    </Card>
  );
}
