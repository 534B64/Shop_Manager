// Opt-in paged reads for the Payments page (ADR 0009 paging contract):
// GET /api/payments and /api/balances answer { rows, total, limit, offset }
// when limit/offset is sent; `q` matches the job title or customer name.
import { and, desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { payments, jobs, customers, invoices, invoiceVoids, salesReturns } from '../../db/schema/index.js';
import { likePattern, type Page, type PageQuery } from '../../lib/paging.js';

const search = (q: unknown): SQL | undefined => {
  const s = typeof q === 'string' ? q.trim() : '';
  if (!s) return undefined;
  const p = likePattern(s);
  return or(sql`${jobs.title} LIKE ${p} ESCAPE '\\'`, sql`${customers.name} LIKE ${p} ESCAPE '\\'`);
};

export const paymentColumns = {
  id: payments.id, jobId: payments.jobId, amountCents: payments.amountCents,
  method: payments.method, kind: payments.kind, voidedAt: payments.voidedAt,
  voidReason: payments.voidReason, note: payments.note, createdAt: payments.createdAt,
  drawerSessionId: payments.drawerSessionId, tenderedCents: payments.tenderedCents,
  changeCents: payments.changeCents, returnId: payments.returnId, invoiceVoidId: payments.invoiceVoidId,
  jobTitle: jobs.title, customerName: customers.name,
};

/** Payment + refund rows, newest first. */
export async function paymentPage(q: Record<string, unknown>, page: PageQuery): Promise<Page<Record<string, unknown>>> {
  const where = search(q.q);
  const rows = await db.select(paymentColumns).from(payments)
    .leftJoin(jobs, eq(payments.jobId, jobs.id)).leftJoin(customers, eq(jobs.customerId, customers.id))
    .where(where).orderBy(desc(payments.createdAt), desc(payments.id)).limit(page.limit).offset(page.offset);
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(payments)
    .leftJoin(jobs, eq(payments.jobId, jobs.id)).leftJoin(customers, eq(jobs.customerId, customers.id)).where(where);
  return { rows, total: Number(n), limit: page.limit, offset: page.offset };
}

/** Jobs with a balance (live, not archived). Unpaged = every one (old shape);
 *  paged = filtered by `q`, largest balance first, in SQL. */
export async function balances(q: Record<string, unknown> = {}, page: PageQuery | null = null) {
  const live = db.$with('live').as(
    db.select({
      jobId: payments.jobId,
      net: sql<number>`sum(case when ${payments.kind} = 'refund' then -${payments.amountCents} else ${payments.amountCents} end)`.as('net'),
    }).from(payments).where(isNull(payments.voidedAt)).groupBy(payments.jobId),
  );
  const ret = db.$with('ret').as(
    db.select({ jobId: invoices.jobId, total: sql<number>`sum(${salesReturns.totalCents})`.as('total') })
      .from(salesReturns).innerJoin(invoices, eq(salesReturns.invoiceId, invoices.id))
      .leftJoin(invoiceVoids, eq(invoiceVoids.invoiceId, invoices.id))
      .where(isNull(invoiceVoids.id)).groupBy(invoices.jobId),
  );
  const price = sql<number | null>`coalesce(${jobs.totalCents}, ${jobs.finalPriceCents})`;
  const owed = sql<number>`coalesce(${jobs.totalCents}, ${jobs.finalPriceCents}, 0) - coalesce(${ret.total}, 0) - coalesce(${live.net}, 0)`;
  const cols = {
    jobId: jobs.id, title: jobs.title, status: jobs.status, customerName: customers.name,
    finalPriceCents: price, paidCents: sql<number>`coalesce(${live.net}, 0)`,
    returnedCents: sql<number>`coalesce(${ret.total}, 0)`,
  };
  const from = () => db.with(live, ret).select(cols).from(jobs)
    .leftJoin(live, eq(live.jobId, jobs.id)).leftJoin(ret, eq(ret.jobId, jobs.id))
    .leftJoin(customers, eq(jobs.customerId, customers.id));
  const withOwed = <T extends { finalPriceCents: number | null; returnedCents: number; paidCents: number }>(r: T) =>
    ({ ...r, owedCents: (r.finalPriceCents ?? 0) - r.returnedCents - r.paidCents });
  if (!page) {
    return (await from().where(isNull(jobs.deletedAt))).map(withOwed).filter((r) => r.owedCents > 0);
  }
  const where = and(isNull(jobs.deletedAt), sql`${owed} > 0`, search(q.q));
  const rows = await from().where(where).orderBy(desc(owed), desc(jobs.id)).limit(page.limit).offset(page.offset);
  const [{ n, sum }] = await db.with(live, ret).select({ n: sql<number>`count(*)`, sum: sql<number>`coalesce(sum(${owed}), 0)` })
    .from(jobs).leftJoin(live, eq(live.jobId, jobs.id)).leftJoin(ret, eq(ret.jobId, jobs.id))
    .leftJoin(customers, eq(jobs.customerId, customers.id)).where(where);
  return { rows: rows.map(withOwed), total: Number(n), totalOwedCents: Number(sum), limit: page.limit, offset: page.offset };
}
