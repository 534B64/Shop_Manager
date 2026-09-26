// Small route helpers shared by the inventory route files.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq, isNull, and } from 'drizzle-orm';
import { db, type Db } from '../../db/index.js';
import { materialColors } from '../../db/schema/index.js';
import { countUnitCost } from '../../../shared/costing.js';
import { parsePage, PagingError, type PageQuery } from '../../lib/paging.js';
import { InventoryError, type TxnUser } from './service.js';

/** Thrown inside a withTx after a reply was already sent (e.g. a missing
 *  approval) to roll the transaction back without a second response. */
export class ReplySent extends Error {
  constructor() { super('reply already sent'); }
}

/** Run a ledger write. A refused one (InventoryError — thrown inside withTx,
 *  so the whole transaction rolled back) becomes its HTTP status + message. */
export async function ledgerWrite<T>(reply: FastifyReply, fn: () => Promise<T>): Promise<T | FastifyReply> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof InventoryError) return reply.code(e.status).send({ error: e.message });
    if (e instanceof ReplySent) return reply;
    throw e;
  }
}

export const txnUser = (req: FastifyRequest): TxnUser => ({ id: req.user?.id ?? null, name: req.user?.name ?? null });


export const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Error && /unique/i.test(e.message);

/** Average cost for a brand-new item: its last cost (per purchase unit)
 *  converted to count units, else 0 (unknown until the first costed receipt). */
export function initialAvgCost(lastCostCents: number | null | undefined, factor: number | null | undefined): number {
  return lastCostCents != null ? Math.round(countUnitCost(lastCostCents, factor)) : 0;
}

/** A SKU's color must be one of the material's admin-defined (non-archived)
 *  colors — a typo would otherwise create an orphan color the stock-check
 *  silently never finds. */
export async function validateSkuColor(materialId: number, color: string, dbx: Db = db): Promise<string | null> {
  const list = await dbx.select().from(materialColors)
    .where(and(eq(materialColors.materialId, materialId), isNull(materialColors.archivedAt)));
  if (list.length === 0) return `This material has no colors set up — add '${color}' on the Materials page first.`;
  if (!list.some((c) => c.name.toLowerCase() === color.toLowerCase())) {
    return `'${color}' is not in this material's color list (${list.map((c) => c.name).join(', ')}). Add it on the Materials page first.`;
  }
  return null;
}

/** The page asked for, null when unpaged, undefined after answering 400. */
export function pagedOr400(q: Record<string, unknown>, reply: FastifyReply): PageQuery | null | undefined {
  try { return parsePage(q); } catch (e) {
    if (!(e instanceof PagingError)) throw e;
    reply.code(400).send({ error: 'bad_paging', message: e.message });
    return undefined;
  }
}
