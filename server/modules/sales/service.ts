// Sales service (Phase 3, ADR 0007): invoices (locked snapshots with a
// gap-free number), invoice voids, returns, and cash-drawer Z-reports.
// Everything that writes takes the caller's withTx handle; a refusal is a
// thrown SalesError so the whole transaction rolls back.
import type { FastifyRequest } from 'fastify';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, type Db } from '../../db/index.js';
import {
  jobs, jobItems, customers, users, payments, invoices, invoiceLines, invoiceVoids,
  salesReturns, salesReturnLines, drawerSessions,
} from '../../db/schema/index.js';
import { audit } from '../audit/index.js';
import { taxRatePct } from '../settings/index.js';
import { owedCents, openDrawer } from '../payments/index.js';
import {
  priceInvoice, taxForTotal, formatInvoiceNumber, buildZReport, type PricedLine, type ZReport,
} from '../../../shared/invoice.js';

export class SalesError extends Error {
  constructor(public status: 400 | 404 | 409, message: string) { super(message); }
}

type Invoice = typeof invoices.$inferSelect;
type Job = typeof jobs.$inferSelect;

/** Take the next invoice number. Must run inside the transaction that inserts
 *  the invoice — a rollback gives the number back (no gaps). */
export async function allocateInvoiceNumber(tx: Db): Promise<number> {
  const rows = await tx.all<{ n: number }>(sql`UPDATE number_sequences SET next_value = next_value + 1
    WHERE name = 'invoice' RETURNING next_value - 1 AS n`);
  if (!rows[0]) throw new Error('invoice number sequence missing');
  return Number(rows[0].n);
}

/** The job's invoice that hasn't been voided, if any. A job has at most one. */
export async function liveInvoiceForJob(jobId: number, dbx: Db = db): Promise<Invoice | null> {
  const [row] = await dbx.select({ inv: invoices }).from(invoices)
    .leftJoin(invoiceVoids, eq(invoiceVoids.invoiceId, invoices.id))
    .where(and(eq(invoices.jobId, jobId), isNull(invoiceVoids.id))).limit(1);
  return row?.inv ?? null;
}

export interface NewLine extends PricedLine {
  description: string;
  detail?: string | null;
  unitPriceCents: number;
  suggestedCents?: number | null;
  inventoryItemId?: number | null;
  stockQty?: number;
}

/** Insert an invoice + its lines (+ audit row) with the next number. */
export async function insertInvoice(tx: Db, req: FastifyRequest, opts: {
  job: Job; source: 'job' | 'counter_sale'; taxRatePct: number; discountPct: number; lines: NewLine[];
  drawerSessionId: number | null; taxExempt?: boolean; taxExemptReason?: string | null;
}) {
  const { job } = opts;
  let customerName: string | null = null;
  if (job.customerId) {
    const [c] = await tx.select({ name: customers.name }).from(customers).where(eq(customers.id, job.customerId));
    customerName = c?.name ?? null;
  }
  const sum = (f: (l: NewLine) => number) => opts.lines.reduce((s, l) => s + f(l), 0);
  const number = await allocateInvoiceNumber(tx);
  const [inv] = await tx.insert(invoices).values({
    number, jobId: job.id, customerId: job.customerId, customerName, jobPo: job.po, title: job.title,
    source: opts.source, taxRatePct: opts.taxRatePct,
    subtotalCents: sum((l) => l.subtotalCents), taxCents: sum((l) => l.taxCents),
    discountPct: opts.discountPct, discountCents: sum((l) => l.discountCents), totalCents: sum((l) => l.totalCents),
    drawerSessionId: opts.drawerSessionId, createdBy: req.user!.name, userId: req.user!.id,
    taxExempt: !!opts.taxExempt, taxExemptReason: opts.taxExempt ? opts.taxExemptReason ?? null : null,
  }).returning();
  const lines = await tx.insert(invoiceLines).values(opts.lines.map((l, i) => ({
    invoiceId: inv.id, lineNo: i + 1, description: l.description, detail: l.detail ?? null,
    qty: l.qty, unitPriceCents: l.unitPriceCents, subtotalCents: l.subtotalCents,
    suggestedCents: l.suggestedCents ?? null, taxable: l.taxable, taxRatePct: l.taxRatePct,
    taxCents: l.taxCents, discountCents: l.discountCents, totalCents: l.totalCents,
    inventoryItemId: l.inventoryItemId ?? null, stockQty: l.stockQty ?? 0,
  }))).returning();
  await audit(tx, req, { action: 'invoice.create', entity: 'invoice', entityId: inv.id, after: { ...inv, lines } });
  return { invoice: inv, lines };
}

/**
 * Invoice a job from its stored money: one line carrying the job's price (the
 * Price field is the whole pre-tax ticket; additional items are advisory and
 * ride along in `detail`), per-line tax at the rate the job's total was
 * computed with, the customer discount as today. A job with no stored total
 * (pre-Phase-11 path) was never charged tax, so its invoice isn't either; a
 * stored total the current rate no longer reproduces keeps its original tax.
 * Returns the existing live invoice when there is one.
 */
export async function invoiceJob(tx: Db, req: FastifyRequest, jobId: number, drawerSessionId: number | null) {
  const existing = await liveInvoiceForJob(jobId, tx);
  if (existing) return { invoice: existing, created: false };
  const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) throw new SalesError(404, 'Job not found');
  const items = await tx.select().from(jobItems).where(and(eq(jobItems.jobId, jobId), isNull(jobItems.deletedAt)));
  const sub = job.finalPriceCents ?? 0;
  const qty = job.quantity > 0 ? job.quantity : 1;
  const hasTotal = job.totalCents != null;
  const rate = job.taxRatePct ?? await taxRatePct(tx);
  const pct = hasTotal ? job.discountPct ?? 0 : 0;
  const taxable = job.taxable && hasTotal;
  let priced = priceInvoice([{ qty, subtotalCents: sub, taxable }], rate, pct);
  if (hasTotal && priced.totalCents !== job.totalCents) {
    const fix = taxForTotal(sub, pct, job.totalCents!);
    const lineRate = sub > 0 ? Math.round((fix.taxCents / sub) * 100 * 1000) / 1000 : 0;
    priced = { ...priced, lines: [{ qty, subtotalCents: sub, taxable: fix.taxCents > 0, taxRatePct: lineRate,
      taxCents: fix.taxCents, discountCents: fix.discountCents, totalCents: job.totalCents! }] };
  }
  const detail = items.length
    ? JSON.stringify(items.map((it) => ({ title: it.title, type: it.type, qty: it.qty, materialId: it.materialId,
      widthIn: it.widthIn, heightIn: it.heightIn })))
    : null;
  const line: NewLine = {
    ...priced.lines[0], description: job.title, detail,
    unitPriceCents: Math.round(sub / qty), suggestedCents: job.suggestedPriceCents,
  };
  const out = await insertInvoice(tx, req, { job, source: 'job', taxRatePct: rate, discountPct: pct, lines: [line], drawerSessionId });
  return { ...out, created: true };
}

/** After a payment: a job that is now paid in full (and not yet invoiced)
 *  gets its invoice in the same transaction. Returns the new invoice or null. */
export async function invoiceIfSettled(tx: Db, req: FastifyRequest, jobId: number) {
  if (await liveInvoiceForJob(jobId, tx)) return null;
  const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job || job.deletedAt) return null;
  if ((job.totalCents ?? job.finalPriceCents ?? 0) <= 0) return null;
  if ((await owedCents(job, tx)) > 0) return null;
  const drawer = await openDrawer(tx);
  return (await invoiceJob(tx, req, jobId, drawer?.id ?? null)).invoice;
}

// ---- Read models ----

export function invoiceHeader(inv: Invoice, extra: { voided?: boolean; returnedCents?: number } = {}) {
  return {
    ...inv, numberDisplay: formatInvoiceNumber(inv.number),
    status: extra.voided ? 'voided' as const : 'issued' as const,
    returnedCents: extra.returnedCents ?? 0,
  };
}

/** Invoice + lines + void + returns (with lines) + the job's payment rows. */
export async function invoiceDetail(inv: Invoice, dbx: Db = db) {
  const lines = await dbx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)).orderBy(asc(invoiceLines.lineNo));
  const [voidRow] = await dbx.select().from(invoiceVoids).where(eq(invoiceVoids.invoiceId, inv.id));
  const rets = await dbx.select().from(salesReturns).where(eq(salesReturns.invoiceId, inv.id)).orderBy(asc(salesReturns.id));
  const retLines = rets.length
    ? await dbx.select().from(salesReturnLines).where(inArray(salesReturnLines.returnId, rets.map((r) => r.id)))
    : [];
  const pays = await dbx.select().from(payments).where(eq(payments.jobId, inv.jobId)).orderBy(asc(payments.id));
  const returnedCents = rets.reduce((s, r) => s + r.totalCents, 0);
  const returnedQty = new Map<number, number>();
  for (const l of retLines) returnedQty.set(l.invoiceLineId, (returnedQty.get(l.invoiceLineId) ?? 0) + l.qty);
  return {
    ...invoiceHeader(inv, { voided: !!voidRow, returnedCents }),
    lines: lines.map((l) => ({ ...l, returnedQty: returnedQty.get(l.id) ?? 0 })),
    void: voidRow ?? null,
    returns: rets.map((r) => ({ ...r, lines: retLines.filter((l) => l.returnId === r.id) })),
    payments: pays,
  };
}

// ---- Drawer / Z-report ----

type Drawer = typeof drawerSessions.$inferSelect;

/** Build the Z-report for a session from its rows (live preview while open). */
export async function computeZReport(d: Drawer, counted: { cash: number | null; checks: number | null }, dbx: Db = db): Promise<ZReport> {
  const pays = await dbx.select().from(payments).where(eq(payments.drawerSessionId, d.id));
  const invs = await dbx.select().from(invoices).where(eq(invoices.drawerSessionId, d.id));
  const voids = await dbx.select({ v: invoiceVoids, total: invoices.totalCents, tax: invoices.taxCents })
    .from(invoiceVoids).innerJoin(invoices, eq(invoiceVoids.invoiceId, invoices.id))
    .where(eq(invoiceVoids.drawerSessionId, d.id));
  const rets = await dbx.select().from(salesReturns).where(eq(salesReturns.drawerSessionId, d.id));
  return buildZReport({
    openingFloatCents: d.openingFloatCents,
    payments: pays.map((p) => ({ method: p.method, kind: p.kind, amountCents: p.amountCents, voided: !!p.voidedAt })),
    invoices: invs.map((i) => ({ number: i.number, subtotalCents: i.subtotalCents, taxCents: i.taxCents,
      discountCents: i.discountCents, totalCents: i.totalCents })),
    voids: voids.map((v) => ({ netTotalCents: v.v.netTotalCents ?? v.total, netTaxCents: v.v.netTaxCents ?? v.tax,
      refundCents: v.v.refundCents })),
    returns: rets.map((r) => ({ totalCents: r.totalCents, taxCents: r.taxCents, refundCents: r.refundCents })),
    countedCashCents: counted.cash, countedChecksCents: counted.checks,
  });
}

/** Session + who opened/closed it + its Z-report (stored when closed,
 *  computed live — `final: false` — while open). */
export async function drawerView(d: Drawer, dbx: Db = db) {
  const ids = [d.openedBy, d.closedBy].filter((x): x is number => x != null);
  const names = new Map((await dbx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)))
    .map((u) => [u.id, u.name]));
  const zReport = d.status === 'closed' && d.zReportJson
    ? JSON.parse(d.zReportJson) as ZReport
    : await computeZReport(d, { cash: null, checks: null }, dbx);
  const { zReportJson: _z, ...rest } = d;
  return {
    ...rest, openedByName: names.get(d.openedBy) ?? null,
    closedByName: d.closedBy != null ? names.get(d.closedBy) ?? null : null,
    final: d.status === 'closed', zReport,
  };
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const dollars = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2));

/** Z-report as `section,item,value` CSV rows (dollars). */
export function zReportCsv(view: Awaited<ReturnType<typeof drawerView>>): string {
  const z = view.zReport;
  const rows: [string, string, string | number][] = [
    ['session', 'id', view.id], ['session', 'register', view.registerId], ['session', 'status', view.status],
    ['session', 'opened_at', view.openedAt], ['session', 'opened_by', view.openedByName ?? ''],
    ['session', 'closed_at', view.closedAt ?? ''], ['session', 'closed_by', view.closedByName ?? ''],
    ['session', 'final', view.final ? 'yes' : 'no'],
    ['cash', 'opening_float', dollars(z.openingFloatCents)],
  ];
  for (const [m, t] of Object.entries(z.byMethod)) {
    rows.push([`tender:${m}`, 'count', t.count], [`tender:${m}`, 'payments', dollars(t.paymentsCents)],
      [`tender:${m}`, 'refunds', dollars(t.refundsCents)], [`tender:${m}`, 'net', dollars(t.netCents)]);
  }
  rows.push(
    ['payments', 'total', dollars(z.paymentsCents)], ['refunds', 'total', dollars(z.refundsCents)],
    ['voided_payments', 'count', z.voidedPayments.count], ['voided_payments', 'amount', dollars(z.voidedPayments.cents)],
    ['sales', 'invoices', z.sales.invoiceCount], ['sales', 'first_invoice', z.sales.firstNumber ?? ''],
    ['sales', 'last_invoice', z.sales.lastNumber ?? ''], ['sales', 'subtotal', dollars(z.sales.subtotalCents)],
    ['sales', 'tax', dollars(z.sales.taxCents)], ['sales', 'discounts', dollars(z.sales.discountCents)],
    ['sales', 'total', dollars(z.sales.totalCents)],
    ['voids', 'count', z.voids.count], ['voids', 'total', dollars(z.voids.totalCents)], ['voids', 'tax', dollars(z.voids.taxCents)],
    ['voids', 'refunded', dollars(z.voids.refundCents)],
    ['returns', 'count', z.returns.count], ['returns', 'total', dollars(z.returns.totalCents)],
    ['returns', 'tax', dollars(z.returns.taxCents)], ['returns', 'refunded', dollars(z.returns.refundCents)],
    ['net', 'sales', dollars(z.netSalesCents)], ['net', 'tax', dollars(z.netTaxCents)],
    ['cash', 'expected', dollars(z.cash.expectedCents)], ['cash', 'counted', dollars(z.cash.countedCents)],
    ['cash', 'over_short', dollars(z.cash.overShortCents)],
    ['checks', 'expected', dollars(z.checks.expectedCents)], ['checks', 'counted', dollars(z.checks.countedCents)],
    ['checks', 'over_short', dollars(z.checks.overShortCents)],
  );
  return ['section,item,value', ...rows.map((r) => r.map(csvCell).join(','))].join('\n');
}
