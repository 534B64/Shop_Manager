// Response shapes of the sales API (ADR 0007) as the POS pages use them.
import type { ZReport } from '../../../shared/invoice';

export interface InvoiceHeader {
  id: number; number: number; numberDisplay: string; jobId: number;
  customerId: number | null; customerName: string | null; jobPo: string | null; title: string;
  source: 'job' | 'counter_sale'; taxRatePct: number;
  subtotalCents: number; taxCents: number; discountPct: number; discountCents: number; totalCents: number;
  drawerSessionId: number | null; createdBy: string | null; createdAt: string;
  status: 'issued' | 'voided'; returnedCents: number;
}

export interface InvoiceLine {
  id: number; lineNo: number; description: string; qty: number; unitPriceCents: number;
  subtotalCents: number; suggestedCents: number | null; taxable: boolean; taxRatePct: number;
  taxCents: number; discountCents: number; totalCents: number;
  inventoryItemId: number | null; stockQty: number; returnedQty: number;
}

export interface PaymentRow {
  id: number; jobId: number; amountCents: number; method: string; kind: 'payment' | 'refund' | string;
  voidedAt: string | null; voidReason: string | null; note: string | null; createdAt: string;
  createdBy?: string | null; drawerSessionId: number | null; tenderedCents: number | null; changeCents: number | null;
  returnId: number | null; invoiceVoidId: number | null;
  jobTitle?: string | null; customerName?: string | null;
}

export interface VoidRow {
  id: number; reason: string; refundCents: number; jobArchived: boolean; createdBy: string | null; createdAt: string;
}

export interface ReturnLineRow {
  id: number; invoiceLineId: number; qty: number; restock: boolean; restockedQty: number; totalCents: number;
  lineNo?: number; description?: string;
}

export interface ReturnRow {
  id: number; invoiceId: number; invoiceNumber?: string; reason: string;
  subtotalCents: number; taxCents: number; discountCents: number; totalCents: number;
  refundCents: number; refundMethod: string | null; createdBy: string | null; createdAt: string;
  lines?: ReturnLineRow[]; refunds?: PaymentRow[];
}

export interface InvoiceDetail extends InvoiceHeader {
  lines: InvoiceLine[]; void: VoidRow | null; returns: ReturnRow[]; payments: PaymentRow[];
}

export interface DrawerSession {
  id: number; registerId: number; status: 'open' | 'closed'; openedAt: string; openedBy: number;
  openingFloatCents: number; openNote: string | null; closedAt: string | null; closedBy: number | null;
  expectedCashCents: number | null; countedCashCents: number | null; overShortCents: number | null;
  expectedChecksCents: number | null; countedChecksCents: number | null; checksOverShortCents: number | null;
  closeNote: string | null;
}

export interface DrawerView extends DrawerSession {
  openedByName: string | null; closedByName: string | null; final: boolean; zReport: ZReport;
}

/** Keyset page from the sales list endpoints. */
export interface KeysetPage<T> { rows: T[]; nextBefore: number | null }

export const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash', card: 'Card', check: 'Check', credit: 'Store credit', other: 'Other',
};
export const methodLabel = (m: string | null | undefined) => (m ? METHOD_LABELS[m] ?? m : '—');
