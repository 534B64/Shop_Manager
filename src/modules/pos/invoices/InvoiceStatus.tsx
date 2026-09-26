import { Badge } from '../../../components/m3';
import { formatCents } from '../../../lib/format';
import type { InvoiceHeader } from '../types';

/** Issued / Returned $x / Voided — words, not color alone. */
export default function InvoiceStatus({ inv }: { inv: Pick<InvoiceHeader, 'status' | 'returnedCents'> }) {
  if (inv.status === 'voided') return <Badge tone="error">Voided</Badge>;
  if (inv.returnedCents > 0) return <Badge tone="warning">Returned {formatCents(inv.returnedCents)}</Badge>;
  return <span className="text-on-surface-variant">Issued</span>;
}
