// Sales & tax for a date range, added up in SQL (ADR 0007). Same rule as the
// Z-report (shared/invoice.ts): invoices issued in the range, minus what the
// voids made in the range cancelled (net of earlier returns), minus returns
// made in the range — each counted on the day it happened.
import type { FastifyInstance } from 'fastify';
import { eq, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { db } from '../../db/index.js';
import { dateRange, DAY_RE } from '../../lib/dates.js';
import { invoices, invoiceVoids, salesReturns } from '../../db/schema/index.js';
import { requireRole } from '../auth/index.js';
import { formatInvoiceNumber, netSales } from '../../../shared/invoice.js';

const sum = (c: SQL | SQLiteColumn) => sql<number>`coalesce(sum(${c}), 0)`;
const range = dateRange; // yyyy-mm-dd = the shop's local day (server/lib/dates.ts)

/** Totals for invoices / voids / returns created between from and to (local yyyy-mm-dd days, inclusive). */
export async function salesReport(from: string | null, to: string | null) {
  const [inv] = await db.select({
    count: sql<number>`count(*)`, first: sql<number | null>`min(${invoices.number})`, last: sql<number | null>`max(${invoices.number})`,
    subtotalCents: sum(invoices.subtotalCents), taxCents: sum(invoices.taxCents),
    discountCents: sum(invoices.discountCents), totalCents: sum(invoices.totalCents),
  }).from(invoices).where(range(invoices.createdAt, from, to));
  const [vd] = await db.select({
    count: sql<number>`count(*)`,
    totalCents: sum(sql`coalesce(${invoiceVoids.netTotalCents}, ${invoices.totalCents})`),
    taxCents: sum(sql`coalesce(${invoiceVoids.netTaxCents}, ${invoices.taxCents})`),
    refundCents: sum(invoiceVoids.refundCents),
  }).from(invoiceVoids).innerJoin(invoices, eq(invoiceVoids.invoiceId, invoices.id))
    .where(range(invoiceVoids.createdAt, from, to));
  const [rt] = await db.select({
    count: sql<number>`count(*)`, totalCents: sum(salesReturns.totalCents),
    taxCents: sum(salesReturns.taxCents), refundCents: sum(salesReturns.refundCents),
  }).from(salesReturns).where(range(salesReturns.createdAt, from, to));
  const n = (x: unknown) => Number(x ?? 0);
  const sales = {
    invoiceCount: n(inv.count),
    firstNumber: inv.first != null ? formatInvoiceNumber(inv.first) : null,
    lastNumber: inv.last != null ? formatInvoiceNumber(inv.last) : null,
    subtotalCents: n(inv.subtotalCents), taxCents: n(inv.taxCents),
    discountCents: n(inv.discountCents), totalCents: n(inv.totalCents),
  };
  const voids = { count: n(vd.count), totalCents: n(vd.totalCents), taxCents: n(vd.taxCents), refundCents: n(vd.refundCents) };
  const returns = { count: n(rt.count), totalCents: n(rt.totalCents), taxCents: n(rt.taxCents), refundCents: n(rt.refundCents) };
  return { from, to, sales, voids, returns, ...netSales(sales, voids, returns) };
}
export type SalesReport = Awaited<ReturnType<typeof salesReport>>;

export async function salesReportRoutes(app: FastifyInstance) {
  // Manager+ (money totals for the shop, like the Z-report).
  app.get('/api/reports/sales', async (req, reply) => {
    if (!requireRole(req, reply, 'manager')) return reply;
    const q = req.query as { from?: string; to?: string };
    for (const v of [q.from, q.to]) {
      if (v && !DAY_RE.test(v)) return reply.code(400).send({ error: 'Dates must be YYYY-MM-DD' });
    }
    return salesReport(q.from || null, q.to || null);
  });
}
