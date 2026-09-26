import type { ReactNode } from 'react';
import { Card, CardHeader, EmptyState, LinearProgress } from '../../components/m3';

/** Card with a loading bar and an error state with retry. */
export default function ReportCard({ title, subtitle, action, loading, error, onRetry, children }: {
  title: string; subtitle?: ReactNode; action?: ReactNode; loading?: boolean; error?: string | null;
  onRetry?: () => void; children?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} action={action} />
      <div className="h-1 mb-2">{loading && <LinearProgress label={`Loading ${title}`} />}</div>
      {error ? (
        <EmptyState tone="error" icon="warning" title="Couldn’t load this"
          action={onRetry && <button type="button" className="text-primary text-label-large underline" onClick={onRetry}>Try again</button>}>
          {error}
        </EmptyState>
      ) : children}
    </Card>
  );
}

/** Label / value rows. */
export function Figures({ rows }: { rows: [string, ReactNode, boolean?][] }) {
  return (
    <dl className="divide-y divide-outline-variant">
      {rows.map(([k, v, strong]) => (
        <div key={k} className="flex justify-between gap-4 py-2">
          <dt className="text-body-medium text-on-surface-variant">{k}</dt>
          <dd className={strong ? 'text-title-medium' : 'text-body-large'}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
