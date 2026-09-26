import { useId, type ReactNode } from 'react';
import { Button, Card, CardHeader, EmptyState, LinearProgress } from '../../components/m3';

/** One dashboard card: title + "Open" link, loading bar, error with retry, body. */
export default function DashCard({ title, subtitle, to, openLabel, loading, error, onRetry, children }: {
  title: string; subtitle?: ReactNode; to: string; openLabel: string;
  loading: boolean; error: string | null; onRetry: () => void; children: ReactNode;
}) {
  const id = useId();
  return (
    <Card variant="outlined" aria-labelledby={id} className="flex flex-col min-h-[18rem]">
      <CardHeader id={id} title={title} subtitle={subtitle}
        action={<Button variant="text" to={to} aria-label={openLabel}>Open</Button>} />
      <div className="h-1 -mt-1 mb-2">{loading && <LinearProgress label={`Loading ${title}`} />}</div>
      {error
        ? <EmptyState tone="error" icon="warning" title="Couldn’t load" action={<Button variant="outlined" onClick={onRetry}>Try again</Button>}>{error}</EmptyState>
        : children}
    </Card>
  );
}
