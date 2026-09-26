// Small route helpers shared by the inventory route files.
import type { FastifyReply, FastifyRequest } from 'fastify';
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
