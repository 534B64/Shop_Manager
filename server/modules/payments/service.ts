// Money math — the single implementation (ADR 0002). Callers outside this
// module import these through index.ts only. Each takes an optional `dbx` so a
// caller inside withTx reads through its own transaction (ADR 0005).
import { eq, sql, and, isNull } from 'drizzle-orm';
import { db, type Db } from '../../db/index.js';
import { payments, customerCredits } from '../../db/schema/index.js';

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
