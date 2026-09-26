// Pure customer rules for the Customers pages (tested in logic.test.ts).
import { isValidEmail, isValidPhone, parseDollarsToCents } from '../../lib/format';
import type { Customer, Job } from '../../lib/types';

export interface CreditEntry { id: number; deltaCents: number; note: string | null; createdAt: string }
export interface CustomerDetail extends Customer {
  creditCents: number; jobs: Job[]; creditLedger: CreditEntry[]; createdAt?: string;
}
export interface InvoiceRow {
  id: number; number: number; numberDisplay: string; jobId: number; title: string;
  totalCents: number; createdAt: string; status: 'issued' | 'voided'; returnedCents: number;
}

export const WALK_IN = 'Walk-in';
export const LEVELS = [0, 1, 2, 3] as const;
const INACTIVE_DAYS = 30;

export interface ProfileInput { name: string; email: string; phone: string; notes: string }
export type ProfileErrors = Partial<Record<keyof ProfileInput, string>>;

/** Field errors for a customer form. Email is required except for Walk-in. */
export function profileErrors(p: ProfileInput): ProfileErrors {
  const e: ProfileErrors = {};
  const name = p.name.trim();
  if (!name) e.name = 'Name is required.';
  const email = p.email.trim();
  if (name !== WALK_IN && !email) e.email = 'Email is required (only the Walk-in record may go without).';
  else if (email && !isValidEmail(email)) e.email = 'Email must contain @ and a dot.';
  if (p.phone.trim() && !isValidPhone(p.phone)) e.phone = 'Phone must be 10 digits.';
  return e;
}

/** No purchase in 30 days (or ever). */
export function isInactive(lastJobAt: string | null | undefined, now = Date.now()): boolean {
  return !lastJobAt || lastJobAt < new Date(now - INACTIVE_DAYS * 86400000).toISOString();
}

/** Signed cents for a credit adjustment, or an error message. */
export function creditDelta(amount: string, direction: 'add' | 'reduce', balanceCents: number): { cents: number } | { error: string } {
  const cents = parseDollarsToCents(amount);
  if (cents === null || cents <= 0) return { error: 'Enter an amount above $0.00.' };
  if (direction === 'reduce' && cents > balanceCents) return { error: 'That would take the credit below zero.' };
  return { cents: direction === 'add' ? cents : -cents };
}

/** Sum of final prices shown on the printed history. */
export const jobsTotal = (jobs: Job[]) => jobs.reduce((s, j) => s + (j.finalPriceCents ?? 0), 0);
