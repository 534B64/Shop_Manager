// Job list reads — the searchable list, the Orders board lanes, and the
// dashboard's due-soon list. Filtered, sorted and limited in SQL so no page
// ever downloads the whole jobs table (ADR 0009).
import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, asc, desc, eq, inArray, isNull, isNotNull, lt, lte, notInArray, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { jobs, customers } from '../../db/schema/index.js';
import { parsePage, PagingError, likePattern } from '../../lib/paging.js';
import { baseQuery } from './queries.js';

/** Board lanes, in pipeline order (proof steps first, picked up last). */
export const BOARD_STATUSES = ['quote', 'approved', 'design', 'acknowledged', 'in_progress', 'done', 'picked_up'] as const;
const CLOSED = ['done', 'picked_up'];

/** title / PO / tags / file ref / customer name contains `q`. */
function searchCond(q: unknown): SQL | undefined {
  if (typeof q !== 'string' || !q.trim()) return undefined;
  const p = likePattern(q.trim());
  const m = (col: SQLWrapper) => sql`${col} LIKE ${p} ESCAPE '\\'`;
  return or(m(jobs.title), m(jobs.po), m(jobs.tags), m(jobs.fileRef), m(customers.name));
}

async function countWhere(where: SQL | undefined): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(jobs)
    .leftJoin(customers, eq(jobs.customerId, customers.id)).where(where);
  return n;
}

const intIn = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return v === undefined || v === '' || !Number.isInteger(n) ? fallback : Math.min(max, Math.max(min, n));
};

/** yyyy-mm-dd in the server's local time (the shop's clock). */
export function localIsoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return localIsoDate(new Date(y, m - 1, d + days));
};

const badPaging = (reply: FastifyReply, e: unknown) => {
  if (e instanceof PagingError) return reply.code(400).send({ error: 'bad_paging', message: e.message });
  throw e;
};

export async function jobListRoutes(app: FastifyInstance) {
  // Newest first. ?q= searches in SQL before the limit; ?status= takes one
  // status or a comma list. Paged ({rows,total,limit,offset}) only when
  // `offset` is sent — `?limit=` alone keeps the old bare-array answer.
  app.get('/api/jobs', async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    const conds: (SQL | undefined)[] = [isNull(jobs.deletedAt), searchCond(query.q)];
    const statuses = (query.status ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (statuses.length) conds.push(inArray(jobs.status, statuses));
    const where = and(...conds);
    if (query.offset === undefined) {
      const max = Math.min(Number(query.limit) || 50, 500);
      return baseQuery().where(where).orderBy(desc(jobs.createdAt), desc(jobs.id)).limit(max);
    }
    let page;
    try { page = parsePage(query)!; } catch (e) { return badPaging(reply, e); }
    const rows = await baseQuery().where(where).orderBy(desc(jobs.createdAt), desc(jobs.id))
      .limit(page.limit).offset(page.offset);
    return { rows, total: await countWhere(where), ...page };
  });

  // The Orders board: every lane's first `limit` jobs (soonest due first;
  // picked up = most recent first) plus each lane's full count.
  app.get('/api/jobs/board', async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const limit = intIn(query.limit, 1, 50, 20);
    const search = searchCond(query.q);
    const lanes = await Promise.all(BOARD_STATUSES.map(async (status) => {
      const where = and(isNull(jobs.deletedAt), eq(jobs.status, status), search);
      const order = status === 'picked_up'
        ? [desc(jobs.id)]
        : [sql`${jobs.dueDate} is null`, asc(jobs.dueDate), asc(jobs.id)];
      const rows = await baseQuery().where(where).orderBy(...order).limit(limit);
      return { status, rows, total: await countWhere(where) };
    }));
    return { lanes, limit };
  });

  // Dashboard: open jobs (not done / picked up) due within `days` of `today`,
  // overdue included, soonest first. `today` is the browser's local date so
  // "due today" matches the person's clock; defaults to the server's.
  app.get('/api/jobs/due-soon', async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const today = query.today && ISO_DAY.test(query.today) ? query.today : localIsoDate(new Date());
    const until = addDays(today, intIn(query.days, 0, 60, 7));
    const limit = intIn(query.limit, 1, 50, 6);
    const open = and(isNull(jobs.deletedAt), notInArray(jobs.status, CLOSED), isNotNull(jobs.dueDate));
    const where = and(open, lte(jobs.dueDate, until));
    const rows = await baseQuery().where(where).orderBy(asc(jobs.dueDate), asc(jobs.id)).limit(limit);
    return {
      rows, today, until, limit,
      total: await countWhere(where),
      overdue: await countWhere(and(open, lt(jobs.dueDate, today))),
    };
  });
}
