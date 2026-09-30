// Roll SKUs (Phase 8) and the advisory stock check for the estimator.
import type { FastifyInstance } from 'fastify';
import { eq, and, isNotNull } from 'drizzle-orm';
import { db, withTx } from '../../db/index.js';
import { inventoryItems, materials } from '../../db/schema/index.js';
import { availabilityCheck, acrossFromDims, type StockLineQuery, type StockResult } from '../../../shared/stockCheck.js';
import { itemDisplayName } from '../../../shared/itemName.js';
import { postTransaction } from './service.js';
import { txnUser, isUniqueViolation, initialAvgCost, validateSkuColor } from './http.js';
import { audit } from '../audit/index.js';

/** One advisory stock check: material + color + part dims → three-state result. */
async function stockCheckOne(materialId: number, color: string, acrossIn: number | null): Promise<StockResult & { message: string | null }> {
  const skus = await db.select().from(inventoryItems).where(and(
    eq(inventoryItems.active, true),
    eq(inventoryItems.materialId, materialId),
    isNotNull(inventoryItems.nominalWidthIn),
  ));
  const forColor = skus.filter((s) => (s.color ?? '').toLowerCase() === color.toLowerCase());
  const inStockWidths = forColor.filter((s) => s.count > 0 && s.nominalWidthIn != null).map((s) => s.nominalWidthIn as number);

  const result = availabilityCheck({ hasStockData: forColor.length > 0, inStockWidths, acrossIn });
  let message: string | null = null;
  if (result.state === 'suboptimal') {
    message = `Optimal ${result.optimalWidth}″ out of stock — using ${result.useWidth}″.`;
  } else if (result.state === 'out_of_stock') {
    const [material] = await db.select().from(materials).where(eq(materials.id, materialId));
    message = `${material?.name ?? 'Material'} ${color} is out of stock — verify before promising.`;
  }
  return { ...result, message };
}

const UNKNOWN_STOCK: StockResult & { message: string | null } =
  { state: 'unknown', optimalWidth: null, useWidth: null, fittingInStock: [], message: null };

export async function rollSkuRoutes(app: FastifyInstance) {
  // ---- Roll SKUs (Phase 8): inventory items tracked by material + color + width ----
  // A roll SKU is just an inventory_item with material_id/color/nominal_width_in
  // set, so the existing cycle-count + adjust + low-stock machinery maintains it.
  app.get('/api/roll-skus', async (req) => {
    const { materialId, color } = req.query as { materialId?: string; color?: string };
    const rows = await db.select().from(inventoryItems)
      .where(and(eq(inventoryItems.active, true), isNotNull(inventoryItems.materialId)));
    return rows.filter((r) =>
      (!materialId || r.materialId === Number(materialId)) &&
      (!color || (r.color ?? '').toLowerCase() === color.toLowerCase()));
  });

  app.post('/api/roll-skus', {
    schema: { body: { type: 'object', required: ['materialId', 'color', 'nominalWidthIn'], additionalProperties: false,
      properties: {
        materialId: { type: 'integer' },
        color: { type: 'string', minLength: 1, maxLength: 60 },
        nominalWidthIn: { type: 'integer', minimum: 1, maximum: 120 },
        count: { type: 'integer', minimum: 0 },
        lowStockThreshold: { type: 'integer', minimum: 0 },
        vendor: { type: 'string', maxLength: 120 },
        lastCostCents: { type: 'integer', minimum: 0 },
      } } },
  }, async (req, reply) => {
    const b = req.body as { materialId: number; color: string; nominalWidthIn: number; count?: number; lowStockThreshold?: number; vendor?: string; lastCostCents?: number };
    const color = b.color.trim();
    // One SKU per material + color + width. The DB unique index (migration
    // 0011) is the real guard — the racy app-level pre-check is gone; a
    // constraint violation maps to the same friendly 409.
    let materialName = '';
    try {
      return await withTx(async (tx) => {
        const [material] = await tx.select().from(materials).where(eq(materials.id, b.materialId));
        if (!material) return reply.code(400).send({ error: 'Unknown material' });
        if (!material.usesRoll) return reply.code(400).send({ error: 'Roll SKUs are only for roll (vinyl) materials' });
        materialName = material.name;
        // The color must exist in the material's admin-defined list — a typo would
        // create an orphan SKU the quote-time stock check silently never finds.
        const colorError = await validateSkuColor(b.materialId, color, tx);
        if (colorError) return reply.code(400).send({ error: colorError });
        let [row] = await tx.insert(inventoryItems).values({
          name: itemDisplayName({ materialName: material.name, color, nominalWidthIn: b.nominalWidthIn }),
          nameIsCustom: false,
          materialId: b.materialId, color, nominalWidthIn: b.nominalWidthIn,
          lowStockThreshold: b.lowStockThreshold ?? 0,
          vendor: b.vendor ?? null, lastCostCents: b.lastCostCents ?? null,
          avgCostCents: initialAvgCost(b.lastCostCents, 1),
          // Whole rolls by decision — see CLAUDE.md.
          purchaseUnit: 'roll', countUnit: 'roll',
        }).returning();
        // Starting count = an 'opening' transaction (ADR 0006).
        let opening = null;
        if (b.count) {
          const r = await postTransaction({ itemId: row.id, type: 'opening', qty: b.count,
            reason: 'opening balance', source: { type: 'manual' }, user: txnUser(req) }, tx);
          row = r.item; opening = r.txn;
        }
        await audit(tx, req, { action: 'inventory_item.create', entity: 'inventory_item', entityId: row.id, after: { ...row, opening } });
        reply.code(201);
        return row;
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        return reply.code(409).send({ error: `A SKU for ${materialName} · ${color} · ${b.nominalWidthIn}in already exists` });
      }
      throw e;
    }
  });

  // Advisory stock CHECK for the estimator — a lookup, never consumption. Reads
  // the roll SKUs of the chosen material+color and returns one of:
  // unknown (no data → show nothing) / in_stock / suboptimal / out_of_stock.
  app.get('/api/stock-check', async (req) => {
    const q = req.query as { materialId?: string; color?: string; widthIn?: string; heightIn?: string };
    const materialId = Number(q.materialId);
    const color = (q.color ?? '').trim();
    if (!materialId || !color) return UNKNOWN_STOCK;
    return stockCheckOne(materialId, color, acrossFromDims(Number(q.widthIn) || null, Number(q.heightIn) || null));
  });

  // Batch stock check — one request covers every line of a multi-item quote
  // (main + additional items), so a flaky-wifi quote costs one round trip, not
  // N. Results come back in the same order as the lines sent. Lines without a
  // material/color return 'unknown' (show nothing) rather than erroring.
  app.post('/api/stock-check/batch', {
    schema: { body: { type: 'object', required: ['lines'], additionalProperties: false,
      properties: { lines: { type: 'array', maxItems: 31, items: { type: 'object',
        required: ['color'], additionalProperties: false,
        properties: {
          materialId: { type: ['integer', 'null'] },
          color: { type: 'string', maxLength: 60 },
          widthIn: { type: ['number', 'null'] },
          heightIn: { type: ['number', 'null'] },
        } } } } } },
  }, async (req) => {
    const { lines } = req.body as { lines: StockLineQuery[] };
    const results = [];
    for (const ln of lines) {
      const color = ln.color.trim();
      results.push(!ln.materialId || !color
        ? UNKNOWN_STOCK
        : await stockCheckOne(ln.materialId, color, acrossFromDims(ln.widthIn, ln.heightIn)));
    }
    return { results };
  });
}
