// Money math — the single implementation (ADR 0002). Callers outside this
// module import these through index.ts only.
import { eq, sql, and, isNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { payments, customerCredits } from '../../db/schema/index.js';

/** Store-credit balance for a customer (signed ledger sum). */
export async function creditBalanceCents(customerId: number): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${customerCredits.deltaCents}), 0)` })
    .from(customerCredits)
    .where(eq(customerCredits.customerId, customerId));
  return row.total;
}

/** Net paid on a job: live payments − live refunds, voided rows excluded. */
export async function paidNetCents(jobId: number): Promise<number> {
  const [row] = await db
    .select({ net: sql<number>`coalesce(sum(case when ${payments.kind} = 'refund' then -${payments.amountCents} else ${payments.amountCents} end), 0)` })
    .from(payments)
    .where(and(eq(payments.jobId, jobId), isNull(payments.voidedAt)));
  return row.net;
}
