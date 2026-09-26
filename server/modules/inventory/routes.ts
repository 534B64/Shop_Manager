// Inventory items: list, create, edit, one item. The ledger, read-outs and
// roll SKUs live in their own route files, registered from here.
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, withTx } from '../../db/index.js';
import { inventoryItems } from '../../db/schema/index.js';
import { postTransaction } from './service.js';
import { ledgerWrite, txnUser, isUniqueViolation, initialAvgCost, validateSkuColor, pagedOr400 } from './http.js';
import { audit } from '../audit/index.js';
import { itemPage } from './lists.js';
import { ledgerRoutes } from './ledger.routes.js';
import { inventoryReportRoutes } from './reports.routes.js';
import { rollSkuRoutes } from './roll-skus.routes.js';

const COUNT_IS_LEDGER = 'On-hand can\'t be edited directly — every quantity change is an inventory transaction. Use Receive stock, an adjustment (POST /api/inventory/:id/adjust), a transfer, or the cycle count.';

export async function inventoryRoutes(app: FastifyInstance) {
  // Unpaged (bare array, every active item) unless limit/offset is given —
  // then { rows, total, limit, offset } with filters/sort in SQL (lists.ts).
  app.get('/api/inventory', async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const page = pagedOr400(q, reply);
    if (page === undefined) return reply;
    if (page) return itemPage(q, page);
    const rows = await db.select().from(inventoryItems);
    return rows.filter((r) => r.active);
  });

  app.post('/api/inventory', {
    schema: { body: { type: 'object', required: ['name'], additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 120 },
        count: { type: 'integer', minimum: 0 },
        lowStockThreshold: { type: 'integer', minimum: 0 },
        vendor: { type: 'string', maxLength: 120 },
        lastCostCents: { type: 'integer', minimum: 0 },
        // Phase 10 taxonomy — orthogonal to the roll-SKU fields above. color
        // was previously roll-SKU-only; plain items may now set it too (e.g.
        // a non-roll material that still comes in colors).
        categoryId: { type: 'integer' },
        sizeText: { type: 'string', maxLength: 60 },
        color: { type: 'string', maxLength: 60 },
        orderNote: { type: 'string', maxLength: 300 },
        // Inventory management pass (2026-07-07): supplier + UOM + Max.
        supplierId: { type: 'integer' },
        purchaseUnit: { type: 'string', maxLength: 24 },
        countUnit: { type: 'string', maxLength: 24 },
        purchaseToCountFactor: { type: 'number', exclusiveMinimum: 0 },
        reorderMaxQty: { type: 'integer', minimum: 0 },
      } } },
  }, async (req, reply) => {
    // A starting count is not written to the item — the item is created at 0
    // and the count arrives as an 'opening' transaction (ADR 0006).
    const { count, ...fields } = req.body as { name: string; count?: number; lastCostCents?: number; purchaseToCountFactor?: number };
    return ledgerWrite(reply, () => withTx(async (tx) => {
      let [row] = await tx.insert(inventoryItems).values({
        ...fields, avgCostCents: initialAvgCost(fields.lastCostCents, fields.purchaseToCountFactor),
      }).returning();
      let opening = null;
      if (count) {
        const r = await postTransaction({ itemId: row.id, type: 'opening', qty: count,
          reason: 'opening balance', source: { type: 'manual' }, user: txnUser(req) }, tx);
        row = r.item; opening = r.txn;
      }
      await audit(tx, req, { action: 'inventory_item.create', entity: 'inventory_item', entityId: row.id, after: { ...row, opening } });
      reply.code(201);
      return row;
    }));
  });

  app.put('/api/inventory/:id', {
    schema: { body: { type: 'object', additionalProperties: false, minProperties: 1,
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 120 },
        lowStockThreshold: { type: 'integer', minimum: 0 },
        vendor: { type: 'string', maxLength: 120 },
        lastCostCents: { type: 'integer', minimum: 0 },
        active: { type: 'boolean' },
        categoryId: { type: ['integer', 'null'] },
        sizeText: { type: ['string', 'null'], maxLength: 60 },
        color: { type: ['string', 'null'], maxLength: 60 },
        orderNote: { type: ['string', 'null'], maxLength: 300 },
        // Inventory management pass (2026-07-07): supplier + UOM + Max.
        supplierId: { type: ['integer', 'null'] },
        purchaseUnit: { type: ['string', 'null'], maxLength: 24 },
        countUnit: { type: ['string', 'null'], maxLength: 24 },
        purchaseToCountFactor: { type: 'number', exclusiveMinimum: 0 },
        reorderMaxQty: { type: ['integer', 'null'], minimum: 0 },
        // Listed only so it isn't silently stripped — it is always refused.
        count: {},
      } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = req.body as { color?: string | null; active?: boolean; count?: unknown; lastCostCents?: number };
    if ('count' in b) return reply.code(400).send({ error: COUNT_IS_LEDGER });
    try {
      return await withTx(async (tx) => {
        const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, id));
        if (!item) return reply.code(404).send({ error: 'Item not found' });
        // Roll SKUs: a color change must stay within the material's color list
        // (same guard as SKU creation — see validateSkuColor).
        const isRollSku = item.materialId != null && item.nominalWidthIn != null;
        if (isRollSku && typeof b.color === 'string' && b.color.trim().toLowerCase() !== (item.color ?? '').toLowerCase()) {
          const colorError = await validateSkuColor(item.materialId as number, b.color.trim(), tx);
          if (colorError) return reply.code(400).send({ error: colorError });
        }
        const patch: Record<string, unknown> = { ...b };
        // An item that has never had a costed receipt has no average yet —
        // seed it from a last cost entered by hand (same rule as migration 0015).
        if (item.avgCostCents === 0 && b.lastCostCents != null) {
          const f = (b as { purchaseToCountFactor?: number }).purchaseToCountFactor ?? item.purchaseToCountFactor;
          patch.avgCostCents = initialAvgCost(b.lastCostCents, f);
        }
        const [row] = await tx.update(inventoryItems).set(patch).where(eq(inventoryItems.id, id)).returning();
        await audit(tx, req, { action: 'inventory_item.update', entity: 'inventory_item', entityId: id, before: item, after: row });
        return row;
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        return reply.code(409).send({ error: 'That change would duplicate an existing roll SKU (same material, color, and width).' });
      }
      throw e;
    }
  });

  // One item (inactive ones too, so old links still open) — the item page.
  app.get('/api/inventory/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(404).send({ error: 'Item not found' });
    const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id));
    return item ?? reply.code(404).send({ error: 'Item not found' });
  });

  await ledgerRoutes(app);
  await inventoryReportRoutes(app);
  await rollSkuRoutes(app);
}
