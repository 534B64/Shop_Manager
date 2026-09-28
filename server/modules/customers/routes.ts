import type { FastifyInstance } from 'fastify';
import { desc, eq, sql, isNull } from 'drizzle-orm';
import { db, withTx } from '../../db/index.js';
import { customers, jobs, customerCredits } from '../../db/schema/index.js';
import { creditBalanceCents } from '../payments/index.js';
import { requireRole, requireApproval, approvalSchema } from '../auth/index.js';
import { audit } from '../audit/index.js';
import { parsePage, PagingError } from '../../lib/paging.js';
import { customerPage, emailOk } from './list.js';

const approvalOnlyBody = { body: { type: ['object', 'null'], additionalProperties: false,
  properties: { approval: approvalSchema } } } as const;

export async function customerRoutes(app: FastifyInstance) {
  // List with last-purchase date; client flags accounts idle > 30 days.
  // Archived customers are hidden unless ?includeArchived=1 (ADR 0005).
  // Paged ({ rows, total, limit, offset }) when limit/offset is sent — the
  // Customers page; pickers keep the old bare-array answer.
  app.get('/api/customers', async (req, reply) => {
    try {
      const page = parsePage(req.query as Record<string, unknown>);
      if (page) return await customerPage(req.query as Record<string, unknown>, page);
    } catch (e) {
      if (!(e instanceof PagingError)) throw e;
      return reply.code(400).send({ error: 'bad_paging', message: e.message });
    }
    const { q: rawQ, includeArchived } = req.query as { q?: string; includeArchived?: string };
    const q = rawQ?.trim();
    const last = db.$with('last').as(
      db.select({ customerId: jobs.customerId, lastJobAt: sql<string>`max(${jobs.createdAt})`.as('last_job_at') })
        .from(jobs).groupBy(jobs.customerId),
    );
    const base = db.with(last)
      .select({
        id: customers.id, name: customers.name, phone: customers.phone,
        email: customers.email, notes: customers.notes, createdAt: customers.createdAt,
        level: customers.level, archivedAt: customers.archivedAt,
        lastJobAt: last.lastJobAt,
      })
      .from(customers)
      .leftJoin(last, eq(last.customerId, customers.id))
      .where(includeArchived === '1' ? undefined : isNull(customers.archivedAt));
    if (q) {
      // Match by name OR phone digits (phones are stored formatted).
      const rows = await base.limit(2000);
      const digits = q.replace(/\D/g, '');
      const needle = q.toLowerCase();
      return rows.filter((c) =>
        c.name.toLowerCase().includes(needle) ||
        (digits.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(digits)),
      ).slice(0, 25);
    }
    return base.orderBy(desc(sql`coalesce(last_job_at, ${customers.createdAt})`)).limit(200);
  });

  // Account view: profile, credit balance, job history, credit ledger.
  // Archived customers still open here (old orders link to them).
  app.get('/api/customers/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const [customer] = await db.select().from(customers).where(eq(customers.id, id));
    if (!customer) return reply.code(404).send({ error: 'Customer not found' });
    const jobRows = await db.select().from(jobs).where(eq(jobs.customerId, id)).orderBy(desc(jobs.createdAt)).limit(100);
    const ledger = await db.select().from(customerCredits).where(eq(customerCredits.customerId, id)).orderBy(desc(customerCredits.createdAt)).limit(50);
    return { ...customer, creditCents: await creditBalanceCents(id), jobs: jobRows, creditLedger: ledger };
  });

  app.post('/api/customers', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 120 },
          phone: { type: 'string', maxLength: 40 },
          email: { type: 'string', maxLength: 120 },
          notes: { type: 'string', maxLength: 2000 },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as { name: string; email?: string };
    // Email is required for new customers (2026-07-02). Sole exemption: a
    // customer named "Walk-in" — POS counter sales don't require a customer
    // at all (D15), but an existing/legacy Walk-in record stays exempt.
    if (!emailOk(body.name, body.email)) {
      return reply.code(400).send({ error: 'An email address is required for new customers.' });
    }
    return withTx(async (tx) => {
      const [row] = await tx.insert(customers).values(body).returning();
      await audit(tx, req, { action: 'customer.create', entity: 'customer', entityId: row.id, after: row });
      reply.code(201);
      return row;
    });
  });

  app.put('/api/customers/:id', {
    schema: { body: { type: 'object', additionalProperties: false, minProperties: 1,
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 120 },
        phone: { type: 'string', maxLength: 40 },
        email: { type: 'string', maxLength: 120 },
        notes: { type: 'string', maxLength: 2000 },
      } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    return withTx(async (tx) => {
      const [before] = await tx.select().from(customers).where(eq(customers.id, id));
      if (!before) return reply.code(404).send({ error: 'Customer not found' });
      // Email on an edit (2026-07-02 rule is for NEW customers): a sent email must
      // be valid, and an existing email can't be cleared (Walk-in excepted). An
      // older customer without one can still have name / phone / notes edited.
      const b = { ...(req.body as { name?: string; email?: string; phone?: string; notes?: string }) };
      const patch: Record<string, unknown> = { ...b };
      if (b.email !== undefined) {
        const email = b.email.trim();
        const name = (b.name ?? before.name).trim();
        if (!email && before.email && name !== 'Walk-in') {
          return reply.code(400).send({ error: 'This customer has an email — it can be changed but not removed.' });
        }
        if (email && !emailOk('', email)) return reply.code(400).send({ error: 'Email must look like name@example.com.' });
        patch.email = email || null;
      }
      // Renaming the Walk-in record into a real customer brings the email rule with it.
      const newName = (b.name ?? before.name).trim();
      if (before.name === 'Walk-in' && newName !== 'Walk-in' && !emailOk(newName, (patch.email ?? before.email) as string | null)) {
        return reply.code(400).send({ error: 'An email address is required (only Walk-in may go without).' });
      }
      const [row] = await tx.update(customers).set(patch).where(eq(customers.id, id)).returning();
      await audit(tx, req, { action: 'customer.update', entity: 'customer', entityId: id, before, after: row });
      return row;
    });
  });

  // Levels (discount tiers) are manager-assigned (ADR 0004).
  app.put('/api/customers/:id/level', {
    schema: { body: { type: 'object', required: ['level'], additionalProperties: false,
      properties: { level: { type: 'integer', minimum: 0, maximum: 3 } } } },
  }, async (req, reply) => {
    if (!requireRole(req, reply, 'manager')) return reply;
    const id = Number((req.params as { id: string }).id);
    const { level } = req.body as { level: number };
    return withTx(async (tx) => {
      const [before] = await tx.select().from(customers).where(eq(customers.id, id));
      if (!before) return reply.code(404).send({ error: 'Customer not found' });
      const [row] = await tx.update(customers).set({ level }).where(eq(customers.id, id)).returning();
      await audit(tx, req, { action: 'customer.level', entity: 'customer', entityId: id,
        before: { level: before.level }, after: { level: row.level } });
      return row;
    });
  });

  // "Delete" = archive (ADR 0005) — manager approval (ADR 0004). The customer
  // disappears from lists and pickers; their orders, payments and credit
  // ledger are untouched, and old orders still show their name.
  app.delete('/api/customers/:id', { schema: approvalOnlyBody }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    return withTx(async (tx) => {
      const [customer] = await tx.select().from(customers).where(eq(customers.id, id));
      if (!customer) return reply.code(404).send({ error: 'Customer not found' });
      if (customer.archivedAt) return { ok: true }; // wifi retry — already done
      const approver = await requireApproval(req, reply, { action: 'customer.delete', entity: 'customer', entityId: id,
        details: { name: customer.name } });
      if (!approver) return reply;
      const [row] = await tx.update(customers)
        .set({ archivedAt: new Date().toISOString(), archivedBy: req.user!.id })
        .where(eq(customers.id, id)).returning();
      await audit(tx, req, { action: 'customer.archive', entity: 'customer', entityId: id,
        before: customer, after: row, approvalId: approver.approvalId });
      return { ok: true };
    });
  });

  app.post('/api/customers/:id/unarchive', { schema: approvalOnlyBody }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    return withTx(async (tx) => {
      const [customer] = await tx.select().from(customers).where(eq(customers.id, id));
      if (!customer) return reply.code(404).send({ error: 'Customer not found' });
      if (!customer.archivedAt) return customer;
      const approver = await requireApproval(req, reply, { action: 'customer.unarchive', entity: 'customer', entityId: id,
        details: { name: customer.name } });
      if (!approver) return reply;
      const [row] = await tx.update(customers).set({ archivedAt: null, archivedBy: null })
        .where(eq(customers.id, id)).returning();
      await audit(tx, req, { action: 'customer.unarchive', entity: 'customer', entityId: id,
        before: customer, after: row, approvalId: approver.approvalId });
      return row;
    });
  });

  // Manual credit adjustment: + grant (goodwill, prepay), − correction.
  // Store credit is money — manager approval (ADR 0004).
  app.post('/api/customers/:id/credit', {
    schema: { body: { type: 'object', required: ['deltaCents'], additionalProperties: false,
      properties: {
        deltaCents: { type: 'integer' },
        note: { type: 'string', maxLength: 300 },
        approval: approvalSchema,
      } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { deltaCents, note } = req.body as { deltaCents: number; note?: string };
    if (deltaCents === 0) return reply.code(400).send({ error: 'Delta cannot be zero' });
    return withTx(async (tx) => {
      const [customer] = await tx.select().from(customers).where(eq(customers.id, id));
      if (!customer) return reply.code(404).send({ error: 'Customer not found' });
      const bal = await creditBalanceCents(id, tx);
      if (bal + deltaCents < 0) return reply.code(409).send({ error: `Credit cannot go negative (current ${(bal / 100).toFixed(2)})` });
      const approver = await requireApproval(req, reply, { action: 'customer.credit_adjust', entity: 'customer', entityId: id,
        reason: note ?? null, details: { deltaCents } });
      if (!approver) return reply;
      const [entry] = await tx.insert(customerCredits).values({ customerId: id, deltaCents, note: note ?? null }).returning();
      await audit(tx, req, { action: 'customer.credit_adjust', entity: 'customer', entityId: id,
        before: { creditCents: bal }, after: { creditCents: bal + deltaCents, entry }, approvalId: approver.approvalId });
      return { creditCents: bal + deltaCents };
    });
  });
}
