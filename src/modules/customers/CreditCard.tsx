import { useState } from 'react';
import { Button, Card, CardHeader, EmptyState, List, ListItem } from '../../components/m3';
import { formatCents, formatDate } from '../../lib/format';
import type { CustomerDetail } from './logic';
import AdjustCreditDialog from './AdjustCreditDialog';

/** Store-credit balance + ledger. Adjustments need a manager (approval dialog for cashiers). */
export default function CreditCard({ customer: c, onChanged }: { customer: CustomerDetail; onChanged: () => void }) {
  const [dir, setDir] = useState<null | 'add' | 'reduce'>(null);
  return (
    <Card>
      <CardHeader title="Store credit" subtitle="Adjustments need a manager’s approval." />
      <p className={c.creditCents > 0 ? 'text-display-small text-success' : 'text-display-small'}
        aria-label={`Store credit balance ${formatCents(c.creditCents)}`}>{formatCents(c.creditCents)}</p>
      <div className="flex flex-wrap gap-2 mt-3 mb-4">
        <Button variant="tonal" icon="add" onClick={() => setDir('add')}>Add credit</Button>
        <Button variant="outlined" onClick={() => setDir('reduce')} disabled={c.creditCents <= 0}>Reduce credit</Button>
      </div>
      <h3 className="text-title-medium mb-1">History</h3>
      {c.creditLedger.length === 0
        ? <EmptyState title="No credit history" />
        : (
          <List label="Store credit history" className="-mx-4 py-0">
            {c.creditLedger.map((e) => (
              <ListItem key={e.id} headline={e.note || '—'} supportingText={formatDate(e.createdAt)}
                trailing={<span className={e.deltaCents > 0 ? 'text-title-medium text-success' : 'text-title-medium text-error'}>
                  {e.deltaCents > 0 ? '+' : ''}{formatCents(e.deltaCents)}</span>} />
            ))}
          </List>
        )}
      {c.creditLedger.length >= 50 && <p className="text-body-small text-on-surface-variant mt-2">Showing the latest 50 entries.</p>}
      <AdjustCreditDialog direction={dir} onClose={() => setDir(null)} customer={c} onSaved={onChanged} />
    </Card>
  );
}
