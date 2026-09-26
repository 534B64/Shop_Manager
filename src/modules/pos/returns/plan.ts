// Return preview: the same shared/invoice.ts math the server runs, so the
// screen shows what the return is worth and how much money goes back before
// it's submitted. The server recomputes everything; its answer is the record.
import { returnLineRefund, refundDueCents } from '../../../../shared/invoice';
import type { InvoiceDetail, InvoiceLine, PaymentRow } from '../types';

export const remainingQty = (l: Pick<InvoiceLine, 'qty' | 'returnedQty'>) => Math.max(0, l.qty - l.returnedQty);
export const canRestock = (l: Pick<InvoiceLine, 'inventoryItemId'>) => l.inventoryItemId != null;

/** Live payments − live refunds on the job (voided rows ignored). */
export function paidNetCents(payments: Pick<PaymentRow, 'kind' | 'amountCents' | 'voidedAt'>[]): number {
  return payments.reduce((s, p) => (p.voidedAt ? s : s + (p.kind === 'refund' ? -p.amountCents : p.amountCents)), 0);
}

export interface ReturnPick { qty: number; restock: boolean }

export interface ReturnPreview {
  lines: { line: InvoiceLine; qty: number; restock: boolean; totalCents: number }[];
  subtotalCents: number; taxCents: number; totalCents: number;
  refundCents: number;
  /** A qty over what's left on some line. */
  invalid: boolean;
}

/** Value of the picked lines + the money due back (only what was overpaid once the return lowers the bill). */
export function previewReturn(inv: InvoiceDetail, picks: Record<number, ReturnPick>): ReturnPreview {
  const out: ReturnPreview = { lines: [], subtotalCents: 0, taxCents: 0, totalCents: 0, refundCents: 0, invalid: false };
  for (const line of inv.lines) {
    const p = picks[line.id];
    if (!p || p.qty <= 0) continue;
    const v = returnLineRefund(line, line.returnedQty, p.qty);
    if (!v) { out.invalid = true; continue; }
    out.lines.push({ line, qty: p.qty, restock: p.restock && canRestock(line), totalCents: v.totalCents });
    out.subtotalCents += v.subtotalCents; out.taxCents += v.taxCents; out.totalCents += v.totalCents;
  }
  out.refundCents = refundDueCents({ returnCents: out.totalCents, invoiceTotalCents: inv.totalCents,
    returnedBeforeCents: inv.returnedCents, paidNetCents: paidNetCents(inv.payments) });
  return out;
}

/** Body lines for POST /api/returns. */
export const toReturnLines = (p: ReturnPreview) =>
  p.lines.map((l) => ({ invoiceLineId: l.line.id, qty: l.qty, ...(l.restock ? { restock: true } : {}) }));
