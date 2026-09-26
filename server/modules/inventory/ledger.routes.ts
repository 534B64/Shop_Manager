// Inventory ledger routes (ADR 0006): adjust/receive, transfer, the
// transaction lists, per-location balances, reconcile, history.
import type { FastifyInstance } from 'fastify';
import { eq, desc, and, lt } from 'drizzle-orm';
import { db, withTx } from '../../db/index.js';
import { inventoryItems, inventoryAdjustments, inventoryBalances, locations } from '../../db/schema/index.js';
import { ADJUST_REASONS, type AdjustReason } from '../../../shared/domain.js';
import { receive, adjust, transfer, reconcile } from './service.js';
import { ledgerWrite, txnUser } from './http.js';
import { requireApproval, requireRole, approvalSchema } from '../auth/index.js';
import { audit } from '../audit/index.js';
import { transactionPage } from './lists.js';

export async function ledgerRoutes(app: FastifyInstance) {
  // All count changes go through the ledger (ADR 0006) — this route is the
  // manual entry point. Receiving = reason 'received' with a delta in COUNT
  // units (the client's receiving form converts purchase units × factor);
  // unitCostCents is the cost paid per PURCHASE unit and is kept on the row —
  // that per-receipt history is what the cost-trend view reads — and moves the
  // moving-average cost. supplierId records who the stock actually came from.
  // Every other reason books as an adjustment / production / sale transaction
  // (see txnTypeForReason) and needs a manager.
  app.post('/api/inventory/:id/adjust', {
    schema: { body: { type: 'object', required: ['delta', 'reason'], additionalProperties: false,
      properties: {
        delta: { type: 'integer' },
        reason: { type: 'string', enum: [...ADJUST_REASONS] },
        note: { type: 'string', maxLength: 300 },
        unitCostCents: { type: 'integer', minimum: 0 },
        supplierId: { type: 'integer' },
        locationId: { type: 'integer' },
        approval: approvalSchema,
      } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { delta, reason, note, unitCostCents, supplierId, locationId } = req.body as {
      delta: number; reason: AdjustReason; note?: string; unitCostCents?: number; supplierId?: number; locationId?: number;
    };
    // One transaction: the approval, the ledger row (its trigger moves the
    // count), the cost update, and the audit row.
    return ledgerWrite(reply, () => withTx(async (tx) => {
      const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, id));
      if (!item) return reply.code(404).send({ error: 'Item not found' });
      if (item.count + delta < 0) return reply.code(409).send({ error: `Count cannot go below zero (have ${item.count})` });
      const isReceipt = reason === 'received';
      // Receiving is day-to-day work; every other manual count change is an
      // override of the books and needs a manager (ADR 0004). The weekly cycle
      // count has its own approval step at posting.
      let approvalId: number | null = null;
      if (!isReceipt) {
        const approver = await requireApproval(req, reply, { action: 'inventory.adjust', entity: 'inventory_item', entityId: id,
          reason: note ?? null, details: { delta, reason, name: item.name, before: item.count } });
        if (!approver) return reply;
        approvalId = approver.approvalId;
      }
      const base = { itemId: id, qty: delta, note: note ?? null, locationId, user: txnUser(req) };
      const r = isReceipt
        ? await receive({ ...base, purchaseUnitCostCents: unitCostCents ?? null, supplierId: supplierId ?? null }, tx)
        : await adjust({ ...base, reason }, tx);
      await audit(tx, req, { action: isReceipt ? 'inventory.receive' : 'inventory.adjust', entity: 'inventory_item',
        entityId: id, before: { count: r.before.count, lastCostCents: r.before.lastCostCents, avgCostCents: r.before.avgCostCents },
        after: { count: r.item.count, lastCostCents: r.item.lastCostCents, avgCostCents: r.item.avgCostCents, transaction: r.txn }, approvalId });
      return r.item;
    }));
  });

  // Move stock between locations (manager+). Item total is unchanged.
  app.post('/api/inventory/:id/transfer', {
    schema: { body: { type: 'object', required: ['fromLocationId', 'toLocationId', 'qty'], additionalProperties: false,
      properties: {
        fromLocationId: { type: 'integer' },
        toLocationId: { type: 'integer' },
        qty: { type: 'integer', minimum: 1 },
        note: { type: 'string', maxLength: 300 },
      } } },
  }, async (req, reply) => {
    if (!requireRole(req, reply, 'manager')) return reply;
    const id = Number((req.params as { id: string }).id);
    const b = req.body as { fromLocationId: number; toLocationId: number; qty: number; note?: string };
    return ledgerWrite(reply, () => withTx(async (tx) => {
      const r = await transfer({ itemId: id, ...b, user: txnUser(req) }, tx);
      await audit(tx, req, { action: 'inventory.transfer', entity: 'inventory_item', entityId: id,
        after: { transferId: r.transferId, from: b.fromLocationId, to: b.toLocationId, qty: b.qty, out: r.out.id, in: r.in.id } });
      return { transferId: r.transferId, item: r.item, transactions: [r.out, r.in] };
    }));
  });

  // An item's inventory transactions, newest first, keyset-paginated on id
  // (?before=<id>&limit=<n ≤ 200>).
  app.get('/api/inventory/:id/transactions', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const q = req.query as { before?: string; limit?: string };
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const before = q.before != null && q.before !== '' ? Number(q.before) : null;
    const rows = await db.select().from(inventoryAdjustments)
      .where(and(eq(inventoryAdjustments.itemId, id), before != null ? lt(inventoryAdjustments.id, before) : undefined))
      .orderBy(desc(inventoryAdjustments.id)).limit(limit);
    return { rows, nextBefore: rows.length === limit ? rows[rows.length - 1].id : null };
  });

  // The ledger across items (Adjustments page), keyset-paged like the per-item
  // one; manager+ because rows carry costs (lists.ts transactionPage).
  app.get('/api/inventory/transactions', async (req, reply) => {
    if (!requireRole(req, reply, 'manager')) return reply;
    return transactionPage(req.query as Record<string, unknown>);
  });

  // On-hand per location for one item.
  app.get('/api/inventory/:id/balances', async (req) => {
    const id = Number((req.params as { id: string }).id);
    return db.select({ locationId: inventoryBalances.locationId, locationName: locations.name, onHand: inventoryBalances.onHand })
      .from(inventoryBalances).innerJoin(locations, eq(inventoryBalances.locationId, locations.id))
      .where(eq(inventoryBalances.itemId, id)).orderBy(locations.id);
  });

  // Integrity check: items / balances whose cached on-hand disagrees with the
  // ledger. The triggers make this impossible, so it should always be empty.
  app.get('/api/inventory/reconcile', async (req, reply) => {
    if (!requireRole(req, reply, 'manager')) return reply;
    return reconcile();
  });

  app.get('/api/inventory/:id/history', async (req) => {
    const id = Number((req.params as { id: string }).id);
    return db.select().from(inventoryAdjustments)
      .where(eq(inventoryAdjustments.itemId, id))
      .orderBy(desc(inventoryAdjustments.createdAt), desc(inventoryAdjustments.id)).limit(50);
  });
}
