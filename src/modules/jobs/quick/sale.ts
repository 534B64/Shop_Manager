// Quick Order sale body + checks. Pure — tested in sale.test.ts.
import { parseDollarsToCents } from '../../../lib/format';

export const METHODS = ['cash', 'card', 'check', 'other'] as const;

export interface SaleForm {
  clientRef: string; customerId: number | null; title: string; amount: string; method: string;
  stockItemId: number | null; stockQty: string;
}

/** The body for POST /api/pos/sale, or the reason it can't be sent. */
export function saleBody(f: SaleForm): { body: Record<string, unknown> } | { error: string } {
  const cents = parseDollarsToCents(f.amount);
  if (!f.customerId) return { error: 'Pick a customer — tap Walk-in if none.' };
  if (!f.title.trim()) return { error: 'Say what it is.' };
  if (cents === null || cents <= 0) return { error: 'Enter the amount, e.g. 12 or 12.50.' };
  const qty = Math.max(1, Math.round(Number(f.stockQty)) || 1);
  return {
    body: {
      clientRef: f.clientRef, title: f.title.trim(), amountCents: cents, method: f.method, customerId: f.customerId,
      ...(f.stockItemId ? { inventoryItemId: f.stockItemId, stockQty: qty } : {}),
    },
  };
}
