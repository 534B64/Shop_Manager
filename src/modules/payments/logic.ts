// Pure rules behind the Payments page. Money is integer cents.
import { parseDollarsToCents } from '../../lib/format';
import { changeCents } from '../../../shared/invoice';

export interface Balance {
  jobId: number; title: string; status: string; customerName: string | null;
  finalPriceCents: number | null; paidCents: number; returnedCents: number; owedCents: number;
}
export interface Summary { count: number; paymentsCents: number; refundsCents: number; netCents: number; byMethod: Record<string, number> }

export const PAYMENT_METHODS = ['cash', 'check', 'card', 'credit', 'other'] as const;

/** How much more than owed (0 when not over). Overpaying is allowed after a confirm (policy 2026-07-02). */
export const overpayCents = (amountCents: number, owedCents: number) => Math.max(0, amountCents - owedCents);

export interface PaymentCheck { amountCents: number | null; tenderedCents: number | null; change: number | null; problem: string | null }

/** Validate the Record payment form: amount, and for cash the tendered cash (optional) and change. */
export function checkPayment(amount: string, method: string, tendered: string): PaymentCheck {
  const amountCents = parseDollarsToCents(amount);
  if (amountCents == null || amountCents <= 0) return { amountCents: null, tenderedCents: null, change: null, problem: 'Enter an amount above $0.00.' };
  if (method !== 'cash' || tendered.trim() === '') return { amountCents, tenderedCents: null, change: null, problem: null };
  const tenderedCents = parseDollarsToCents(tendered);
  if (tenderedCents == null) return { amountCents, tenderedCents: null, change: null, problem: 'Cash tendered isn’t an amount.' };
  const change = changeCents(amountCents, tenderedCents);
  return { amountCents, tenderedCents, change, problem: change == null ? 'Cash tendered is less than the amount.' : null };
}
