// Money math — the single implementation (ADR 0002). Callers outside this
// module import these through index.ts only. Each takes an optional `dbx` so a
// caller inside withTx reads through its own transaction (ADR 0005).
import type { FastifyRequest } from 'fastify';
import { eq, sql, and, isNull, desc } from 'drizzle-orm';
import { db, type Db } from '../../db/index.js';
import {
  payments, customerCredits, drawerSessions, invoices, invoiceVoids, salesReturns,
} from '../../db/schema/index.js';
import { audit } from '../audit/index.js';
import { changeCents } from '../../../shared/invoice.js';

/** A refused money write; routes map `status` straight to the reply. Thrown
 *  inside withTx so everything written before it rolls back. */
export class PaymentError extends Error {
  constructor(public status: 400 | 404 | 409, message: string, public code?: string) { super(message); }
}

export const NO_DRAWER_MESSAGE = 'No cash drawer is open — open the drawer (count the starting float) before taking or refunding cash.';

/** Store-credit balance for a customer (signed ledger sum). */
export async function creditBalanceCents(customerId: number, dbx: Db = db): Promise<number> {
  const [row] = await dbx
    .select({ total: sql<number>`coalesce(sum(${customerCredits.deltaCents}), 0)` })
    .from(customerCredits)
    .where(eq(customerCredits.customerId, customerId));
  return row.total;
}

/** Net paid on a job: live payments − live refunds, voided rows excluded. */
export async function paidNetCents(jobId: number, dbx: Db = db): Promise<number> {
  const [row] = await dbx
    .select({ net: sql<number>`coalesce(sum(case when ${payments.kind} = 'refund' then -${payments.amountCents} else ${payments.amountCents} end), 0)` })
    .from(payments)
    .where(and(eq(payments.jobId, jobId), isNull(payments.voidedAt)));
  return row.net;
}

/** Live (non-voided) payment/refund row count for a job. Used by the
 *  jobs module's removal rule: any live money row blocks a soft delete. */
export async function livePaymentCount(jobId: number, dbx: Db = db): Promise<number> {
  const [row] = await dbx
    .select({ n: sql<number>`count(*)` })
    .from(payments)
    .where(and(eq(payments.jobId, jobId), isNull(payments.voidedAt)));
  return row.n;
}

/** Value of goods returned against a job's live (unvoided) invoice(s) —
 *  it lowers what the customer owes (Phase 3). */
export async function returnedCents(jobId: number, dbx: Db = db): Promise<number> {
  const [row] = await dbx
    .select({ total: sql<number>`coalesce(sum(${salesReturns.totalCents}), 0)` })
    .from(salesReturns)
    .innerJoin(invoices, eq(salesReturns.invoiceId, invoices.id))
    .leftJoin(invoiceVoids, eq(invoiceVoids.invoiceId, invoices.id))
    .where(and(eq(invoices.jobId, jobId), isNull(invoiceVoids.id)));
  return row.total;
}

/** Balance = after-tax total − returned goods − live payments + live refunds. */
export async function owedCents(
  job: { id: number; totalCents: number | null; finalPriceCents: number | null }, dbx: Db = db,
): Promise<number> {
  return (job.totalCents ?? job.finalPriceCents ?? 0) - (await returnedCents(job.id, dbx)) - (await paidNetCents(job.id, dbx));
}

/** The open cash drawer session (register 1), or null. */
export async function openDrawer(dbx: Db = db, registerId = 1) {
  const [row] = await dbx.select().from(drawerSessions)
    .where(and(eq(drawerSessions.status, 'open'), eq(drawerSessions.registerId, registerId)))
    .orderBy(desc(drawerSessions.id)).limit(1);
  return row ?? null;
}

export interface RecordPaymentInput {
  clientRef?: string | null;
  jobId: number;
  /** The job's customer — needed for method 'credit'. */
  customerId: number | null;
  amountCents: number;
  method: string;
  kind: 'payment' | 'refund';
  note?: string | null;
  /** Cash payments only: what the customer handed over. */
  tenderedCents?: number | null;
  returnId?: number | null;
  invoiceVoidId?: number | null;
  approvalId?: number | null;
}

/**
 * The one way a payment/refund row is written (POST /api/payments, counter
 * sales, invoice voids, returns). Inside the caller's transaction:
 * - cash needs an open drawer (409 otherwise); every row taken while a drawer
 *   is open is attached to it, so the Z-report sees card/check too;
 * - cash payments may record tendered + change (tendered ≥ amount);
 * - 'credit' draws the customer's store credit down (payment, 409 when short)
 *   or restores it (refund) through the credit ledger;
 * - one audit row.
 */
export async function recordPayment(tx: Db, req: FastifyRequest, input: RecordPaymentInput) {
  const drawer = await openDrawer(tx);
  if (input.method === 'cash' && !drawer) throw new PaymentError(409, NO_DRAWER_MESSAGE, 'drawer_closed');
  let tenderedCents: number | null = null;
  let change: number | null = null;
  if (input.tenderedCents != null) {
    if (input.method !== 'cash' || input.kind !== 'payment') throw new PaymentError(400, 'Cash tendered applies to cash payments only');
    change = changeCents(input.amountCents, input.tenderedCents);
    if (change == null) throw new PaymentError(400, 'Cash tendered is less than the amount');
    tenderedCents = input.tenderedCents;
  }

  let creditDeltaCents: number | null = null;
  if (input.method === 'credit') {
    if (!input.customerId) throw new PaymentError(400, 'Job has no customer — credit needs an account');
    if (input.kind === 'payment') {
      const bal = await creditBalanceCents(input.customerId, tx);
      if (bal < input.amountCents) throw new PaymentError(409, `Customer credit is ${(bal / 100).toFixed(2)} — not enough`);
    }
    // Payment by credit draws the account down; refund-to-credit stores
    // value on the account instead of handing back cash.
    creditDeltaCents = input.kind === 'payment' ? -input.amountCents : input.amountCents;
    await tx.insert(customerCredits).values({
      customerId: input.customerId, deltaCents: creditDeltaCents,
      note: input.kind === 'payment' ? `Applied to job #${input.jobId}` : `Refund from job #${input.jobId}`,
    });
  }

  const [row] = await tx.insert(payments).values({
    clientRef: input.clientRef ?? null, jobId: input.jobId, amountCents: input.amountCents,
    method: input.method, kind: input.kind, note: input.note ?? null, createdBy: req.user!.name,
    drawerSessionId: drawer?.id ?? null, tenderedCents, changeCents: change,
    returnId: input.returnId ?? null, invoiceVoidId: input.invoiceVoidId ?? null,
  }).returning();
  await audit(tx, req, { action: input.kind === 'refund' ? 'payment.refund' : 'payment.create', entity: 'payment',
    entityId: row.id, after: { ...row, creditDeltaCents, customerId: input.customerId }, approvalId: input.approvalId ?? null });
  return row;
}
