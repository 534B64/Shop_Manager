import type { FastifyInstance } from 'fastify';
import { like, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { customers, jobs, customerCredits, settings as settingsTable } from '../db/schema/index.js';
import { creditBalanceCents } from '../modules/payments/index.js';

export async function customerRoutes(app: FastifyInstance) {
  // List with last-purchase date; client flags accounts idle > 30 days.
  app.get('/api/customers', async (req) => {
    const q = (req.query as { q?: string }).q?.trim();
    const last = db.$with('last').as(
      db.select({ customerId: jobs.customerId, lastJobAt: sql<string>`max(${jobs.createdAt})`.as('last_job_at') })
        .from(jobs).groupBy(jobs.customerId),
    );
    const base = db.with(last)
      .select({
        id: customers.id, name: customers.name, phone: customers.phone,
        email: customers.email, notes: customers.notes, createdAt: customers.createdAt,
        level: customers.level,
        lastJobAt: last.lastJobAt,
      })
      .from(customers)
      .leftJoin(last, eq(last.customerId, customers.id));
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
    // Email is required for new customers (2026-07-02). Sole exemption: the
    // generic "Walk-in" counter record Quick Order auto-creates.
    if (body.name.trim() !== 'Walk-in') {
      if (!body.email || !/^\S+@\S+\.\S+$/.test(body.email)) {
        return reply.code(400).send({ error: 'An email address is required for new customers.' });
      }
    }
    const [row] = await db.insert(customers).values(body).returning();
    reply.code(201);
    return row;
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
    const [row] = await db.update(customers).set(req.body as object).where(eq(customers.id, id)).returning();
    if (!row) return reply.code(404).send({ error: 'Customer not found' });
    return row;
  });

  // Levels are admin-assigned only.
  app.put('/api/customers/:id/level', {
    schema: { body: { type: 'object', required: ['level', 'adminPassword'], additionalProperties: false,
      properties: { level: { type: 'integer', minimum: 0, maximum: 3 }, adminPassword: { type: 'string' } } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { level, adminPassword } = req.body as { level: number; adminPassword: string };
    const [pwRow] = await db.select().from(settingsTable).where(eq(settingsTable.key, 'adminPassword'));
    if (adminPassword !== (pwRow?.value ?? 'admin')) return reply.code(401).send({ error: 'Admin password required' });
    const [row] = await db.update(customers).set({ level }).where(eq(customers.id, id)).returning();
    if (!row) return reply.code(404).send({ error: 'Customer not found' });
    return row;
  });

  // Remove a customer with the admin password. Blocked if they have any order
  // history — those rows are the books and must stay; only clean/duplicate/mistake
  // accounts (no jobs) can be removed. Their credit ledger is cleared with them.
  app.delete('/api/customers/:id', {
    schema: { body: { type: 'object', required: ['adminPassword'], additionalProperties: false,
      properties: { adminPassword: { type: 'string' } } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { adminPassword } = req.body as { adminPassword: string };
    const [pwRow] = await db.select().from(settingsTable).where(eq(settingsTable.key, 'adminPassword'));
    if (adminPassword !== (pwRow?.value ?? 'admin')) return reply.code(401).send({ error: 'Admin password required' });
    const [jobRef] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.customerId, id)).limit(1);
    if (jobRef) return reply.code(409).send({ error: 'This customer has order history — it cannot be removed (the books stay intact).' });
    await db.delete(customerCredits).where(eq(customerCredits.customerId, id));
    const [row] = await db.delete(customers).where(eq(customers.id, id)).returning();
    if (!row) return reply.code(404).send({ error: 'Customer not found' });
    return { ok: true };
  });

  // Manual credit adjustment: + grant (goodwill, prepay), − correction.
  app.post('/api/customers/:id/credit', {
    schema: { body: { type: 'object', required: ['deltaCents'], additionalProperties: false,
      properties: {
        deltaCents: { type: 'integer' },
        note: { type: 'string', maxLength: 300 },
      } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { deltaCents, note } = req.body as { deltaCents: number; note?: string };
    if (deltaCents === 0) return reply.code(400).send({ error: 'Delta cannot be zero' });
    const [customer] = await db.select().from(customers).where(eq(customers.id, id));
    if (!customer) return reply.code(404).send({ error: 'Customer not found' });
    const bal = await creditBalanceCents(id);
    if (bal + deltaCents < 0) return reply.code(409).send({ error: `Credit cannot go negative (current ${(bal / 100).toFixed(2)})` });
    await db.insert(customerCredits).values({ customerId: id, deltaCents, note: note ?? null });
    return { creditCents: bal + deltaCents };
  });
}
