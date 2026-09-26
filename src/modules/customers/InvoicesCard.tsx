import { Badge, Card, CardHeader, EmptyState, LinearProgress, List, ListItem } from '../../components/m3';
import KeysetPager from '../../components/KeysetPager';
import { useKeyset } from '../../lib/keysetPaging';
import { formatCents, formatDate } from '../../lib/format';
import type { InvoiceRow } from './logic';

/** The customer's invoices, newest first, each opening the invoice page. */
export default function InvoicesCard({ customerId }: { customerId: number }) {
  const inv = useKeyset<InvoiceRow>('/api/invoices', { customerId }, 10);
  return (
    <Card padded={false} className="pt-4">
      <div className="px-4"><CardHeader title="Invoices" subtitle="Locked records of each sale." /></div>
      <div className="h-1">{inv.loading && <LinearProgress label="Loading invoices" />}</div>
      {inv.error ? (
        <EmptyState tone="error" icon="warning" title="Couldn’t load invoices"
          action={<button type="button" className="text-primary text-label-large underline" onClick={inv.reload}>Try again</button>}>
          {inv.error}
        </EmptyState>
      ) : inv.rows.length === 0 && !inv.loading ? <EmptyState title="No invoices yet" /> : (
        <List label="Invoices" className="py-0">
          {inv.rows.map((r) => (
            <ListItem key={r.id} to={`/pos/invoices/${r.numberDisplay}`}
              headline={<span className="flex items-center gap-2">#{r.numberDisplay} · {r.title}
                {r.status === 'voided' && <Badge tone="error" className="!h-5 px-2">Voided</Badge>}</span>}
              supportingText={`${formatDate(r.createdAt)}${r.returnedCents ? ` · returned ${formatCents(r.returnedCents)}` : ''}`}
              trailing={<span className="text-title-small text-on-surface">{formatCents(r.totalCents)}</span>} />
          ))}
        </List>
      )}
      {(inv.hasPrev || inv.hasNext) && <KeysetPager paging={inv} />}
    </Card>
  );
}
