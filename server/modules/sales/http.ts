// Small helpers shared by the sales route files.
import type { FastifyReply } from 'fastify';
import { SalesError } from './service.js';
import { PaymentError } from '../payments/index.js';
import { InventoryError } from '../inventory/index.js';

/** Run a write; a refused SalesError/PaymentError/InventoryError (thrown
 *  inside withTx, so it rolled back) becomes its HTTP status. */
export async function refusable<T>(reply: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SalesError || e instanceof PaymentError || e instanceof InventoryError) {
      return reply.code(e.status).send({ error: e.message, ...(e instanceof PaymentError && e.code ? { code: e.code } : {}) });
    }
    throw e;
  }
}

export const pageLimit = (v?: string) => Math.min(Math.max(Number(v) || 50, 1), 200);
