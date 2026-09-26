// Saving the form: create (idempotent by clientRef — a retry over bad wifi
// returns the same job) or edit. A price override triggers the manager
// approval dialog from api.ts; an invoiced job refuses locked fields (409).
import { useState } from 'react';
import { post, put } from '../../../lib/api';
import { formatCents } from '../../../lib/format';
import type { Customer, Material } from '../../../lib/types';
import { errorText, lockedInvoice } from '../shared/errors';
import type { JobDetail, PriceCheck } from '../types';
import { buildPayload, validate, type CustomerDraft, type QuoteDraft } from './draft';
import type { QuoteMath } from './math';

type Saved = JobDetail & { priceCheck?: PriceCheck };

export function useSaveQuote(job: JobDetail | null, materials: Material[], onCustomer: (c: CustomerDraft) => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedBy, setLockedBy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save(draft: QuoteDraft, math: QuoteMath, status?: 'quote' | 'acknowledged'): Promise<Saved | null> {
    const invalid = validate(draft);
    if (invalid) { setError(invalid); return null; }
    setSaving(true); setError(null); setLockedBy(null);
    try {
      const locked = !!job?.invoice;
      const body: Record<string, unknown> = buildPayload(draft, materials, math, { status, locked });
      let saved: Saved;
      if (!job) {
        saved = await post<Saved>('/api/jobs', { clientRef: draft.clientRef, ...body });
      } else {
        if ('newCustomer' in body) {
          // An edit can't create a customer inline — make it first, then point the job at it.
          const c = await post<Customer>('/api/customers', body.newCustomer);
          onCustomer({ id: c.id, name: c.name, phone: c.phone ?? '', email: c.email ?? '', level: c.level ?? 0 });
          delete body.newCustomer;
          body.customerId = c.id;
        }
        saved = await put<Saved>(`/api/jobs/${job.id}`, body);
      }
      const pc = saved.priceCheck;
      setNotice(pc && !pc.verified
        ? `The server recalculated this and stored ${formatCents(pc.serverTotalCents)} as the total — this screen’s tax or pricing settings were out of date. Reload the page to pick up the current ones.`
        : null);
      return saved;
    } catch (e) {
      const inv = lockedInvoice(e);
      if (inv) setLockedBy(inv);
      setError(errorText(e, 'Save failed — safe to retry.'));
      return null;
    } finally { setSaving(false); }
  }

  return { save, saving, error, lockedBy, notice, clearNotice: () => setNotice(null) };
}
