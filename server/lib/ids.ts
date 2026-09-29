// Ids in URLs (/api/jobs/:id, /api/materials/:id/colors/:colorId, ...) are whole
// numbers. Anything else ("board", "abc", "NaN", "1.5") is "not found" — never
// a database error. One check for every route, registered once in app.ts.
import type { FastifyReply, FastifyRequest } from 'fastify';

/** Route parameters that hold a database id. (`number` on /api/invoices/:number is an invoice number, checked by its own route.) */
export const ID_PARAMS = ['id', 'colorId', 'sizeId'] as const;

/** The id as a number, or null when it is not a plain whole number. */
export function parseId(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
  if (typeof raw !== 'string' || !/^\d{1,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/** True when any id-like route parameter is present but not a whole number. */
export function hasBadId(params: unknown): boolean {
  const p = (params ?? {}) as Record<string, unknown>;
  return ID_PARAMS.some((k) => k in p && parseId(p[k]) === null);
}

/** onRequest hook: 404 {error:'Not found'} for a non-integer id. */
export async function rejectBadIds(req: FastifyRequest, reply: FastifyReply) {
  if (hasBadId(req.params)) return reply.code(404).send({ error: 'Not found' });
}
