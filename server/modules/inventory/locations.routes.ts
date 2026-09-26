import type { FastifyInstance } from 'fastify';
import { and, eq, ne } from 'drizzle-orm';
import { db, withTx } from '../../db/index.js';
import { locations, inventoryBalances } from '../../db/schema/index.js';
import { requireRole } from '../auth/index.js';
import { audit } from '../audit/index.js';
import { DEFAULT_LOCATION_ID } from './service.js';

// ---- Locations (Phase 2, ADR 0006) ----
// Where stock sits; inventory_balances holds on-hand per item per location.
// Admin-managed. "Delete" archives (ADR 0005) and is refused while anything
// is still on hand there (transfer it out first) and for the default Shop
// location, which postings fall back to.

const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Error && /unique/i.test(e.message);

const nameSchema = { type: 'string', minLength: 1, maxLength: 60 } as const;

export async function locationRoutes(app: FastifyInstance) {
  app.get('/api/locations', async (req) => {
    const { includeArchived } = req.query as { includeArchived?: string };
    const rows = await db.select().from(locations).orderBy(locations.id);
    return rows.filter((l) => includeArchived === '1' || !l.archivedAt);
  });

  app.post('/api/locations', {
    schema: { body: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: nameSchema } } },
  }, async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    const { name } = req.body as { name: string };
    try {
      return await withTx(async (tx) => {
        const [row] = await tx.insert(locations).values({ name: name.trim() }).returning();
        await audit(tx, req, { action: 'location.create', entity: 'location', entityId: row.id, after: row });
        reply.code(201);
        return row;
      });
    } catch (e) {
      if (isUniqueViolation(e)) return reply.code(409).send({ error: 'A location with that name already exists' });
      throw e;
    }
  });

  app.put('/api/locations/:id', {
    schema: { body: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: nameSchema } } },
  }, async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    const id = Number((req.params as { id: string }).id);
    const { name } = req.body as { name: string };
    try {
      return await withTx(async (tx) => {
        const [before] = await tx.select().from(locations).where(eq(locations.id, id));
        if (!before) return reply.code(404).send({ error: 'Location not found' });
        const [row] = await tx.update(locations).set({ name: name.trim() }).where(eq(locations.id, id)).returning();
        await audit(tx, req, { action: 'location.update', entity: 'location', entityId: id, before, after: row });
        return row;
      });
    } catch (e) {
      if (isUniqueViolation(e)) return reply.code(409).send({ error: 'A location with that name already exists' });
      throw e;
    }
  });

  app.delete('/api/locations/:id', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    const id = Number((req.params as { id: string }).id);
    if (id === DEFAULT_LOCATION_ID) return reply.code(409).send({ error: 'The default Shop location can\'t be archived' });
    return withTx(async (tx) => {
      const [before] = await tx.select().from(locations).where(eq(locations.id, id));
      if (!before) return reply.code(404).send({ error: 'Location not found' });
      if (before.archivedAt) return { ok: true };
      const [stocked] = await tx.select({ itemId: inventoryBalances.itemId }).from(inventoryBalances)
        .where(and(eq(inventoryBalances.locationId, id), ne(inventoryBalances.onHand, 0))).limit(1);
      if (stocked) return reply.code(409).send({ error: 'Stock is still on hand there — transfer it out first' });
      const [row] = await tx.update(locations).set({ archivedAt: new Date().toISOString(), archivedBy: req.user!.id })
        .where(eq(locations.id, id)).returning();
      await audit(tx, req, { action: 'location.archive', entity: 'location', entityId: id, before, after: row });
      return { ok: true };
    });
  });

  app.post('/api/locations/:id/unarchive', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    const id = Number((req.params as { id: string }).id);
    return withTx(async (tx) => {
      const [before] = await tx.select().from(locations).where(eq(locations.id, id));
      if (!before) return reply.code(404).send({ error: 'Location not found' });
      if (!before.archivedAt) return before;
      const [row] = await tx.update(locations).set({ archivedAt: null, archivedBy: null })
        .where(eq(locations.id, id)).returning();
      await audit(tx, req, { action: 'location.unarchive', entity: 'location', entityId: id, before, after: row });
      return row;
    });
  });
}
