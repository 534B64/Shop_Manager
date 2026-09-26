// Paged customer list (UI foundation, ADR 0009): search, archive filter,
// sort and paging in SQL. Same contract as server/lib/paging.ts.
import { and, asc, desc, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { customers, jobs } from '../../db/schema/index.js';
import { likePattern, parseDir, parseSort, type Page, type PageQuery } from '../../lib/paging.js';

type Q = Record<string, unknown>;
const C = customers;
const SORTS = ['recent', 'name', 'created'] as const;

// Phones are stored formatted — strip the usual punctuation to match digits.
const phoneDigits = sql`replace(replace(replace(replace(replace(coalesce(${C.phone}, ''), '(', ''), ')', ''), '-', ''), ' ', ''), '.', '')`;
const lastJobAt = sql<string | null>`(select max(${jobs.createdAt}) from ${jobs} where ${jobs.customerId} = ${C.id})`;

/** WHERE for q (name / email contains, or phone digits) and archived. */
export function customerFilters(q: Q): SQL[] {
  const conds: SQL[] = [];
  if (q.includeArchived !== '1') conds.push(isNull(C.archivedAt));
  const search = typeof q.q === 'string' ? q.q.trim() : '';
  if (search) {
    const p = likePattern(search);
    const alts: SQL[] = [sql`${C.name} LIKE ${p} ESCAPE '\\'`, sql`coalesce(${C.email}, '') LIKE ${p} ESCAPE '\\'`];
    const digits = search.replace(/\D/g, '');
    if (digits.length >= 3) alts.push(sql`${phoneDigits} LIKE ${`%${digits}%`}`);
    conds.push(or(...alts)!);
  }
  return conds;
}

/** ?q=&includeArchived=1&sort=recent|name|created&dir= → { rows, total, limit, offset }. */
export async function customerPage(q: Q, page: PageQuery): Promise<Page<Record<string, unknown>>> {
  const where = and(...customerFilters(q));
  const sort = parseSort(q.sort, SORTS, 'recent');
  const dir = q.dir === undefined ? (sort === 'name' ? 'asc' : 'desc') : parseDir(q.dir);
  const by = dir === 'asc' ? asc : desc;
  const key = sort === 'name' ? sql`${C.name} collate nocase`
    : sort === 'created' ? sql`${C.createdAt}`
    : sql`coalesce(${lastJobAt}, ${C.createdAt})`;
  const rows = await db.select({
    id: C.id, name: C.name, phone: C.phone, email: C.email, notes: C.notes, createdAt: C.createdAt,
    level: C.level, archivedAt: C.archivedAt, lastJobAt,
  }).from(C).where(where).orderBy(by(key), by(C.id)).limit(page.limit).offset(page.offset);
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(C).where(where);
  return { rows, total: Number(n), limit: page.limit, offset: page.offset };
}

/** Email is required on every customer except the generic "Walk-in" record. */
export const emailOk = (name: string, email: string | null | undefined) =>
  name.trim() === 'Walk-in' || (!!email && /^\S+@\S+\.\S+$/.test(email));
