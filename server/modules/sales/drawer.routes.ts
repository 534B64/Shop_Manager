// The cash drawer (ADR 0007): open, current, close (Z-report), history.
import type { FastifyInstance } from 'fastify';
import { desc, eq, lt } from 'drizzle-orm';
import { db, withTx } from '../../db/index.js';
import { drawerSessions } from '../../db/schema/index.js';
import { audit } from '../audit/index.js';
import { requireRole } from '../auth/index.js';
import { openDrawer } from '../payments/index.js';
import { SalesError, computeZReport, drawerView, zReportCsv } from './service.js';
import { refusable, pageLimit } from './http.js';

export async function drawerRoutes(app: FastifyInstance) {
  app.post('/api/drawer/open', {
    schema: { body: { type: 'object', required: ['openingFloatCents'], additionalProperties: false,
      properties: {
        openingFloatCents: { type: 'integer', minimum: 0, maximum: 10_000_000 },
        note: { type: 'string', maxLength: 300 },
      } } },
  }, async (req, reply) => {
    const body = req.body as { openingFloatCents: number; note?: string };
    return refusable(reply, () => withTx(async (tx) => {
      const current = await openDrawer(tx);
      if (current) throw new SalesError(409, `Drawer #${current.id} is already open — close it before opening another`);
      const [d] = await tx.insert(drawerSessions).values({
        openedBy: req.user!.id, openingFloatCents: body.openingFloatCents, openNote: body.note ?? null,
      }).returning();
      await audit(tx, req, { action: 'drawer.open', entity: 'drawer_session', entityId: d.id, after: d });
      reply.code(201);
      return drawerView(d, tx);
    }));
  });

  // The open session with a live Z-report preview, or {drawer: null}.
  app.get('/api/drawer/current', async () => {
    const d = await openDrawer();
    return { drawer: d ? await drawerView(d) : null };
  });

  // Close = count the drawer: expected vs counted cash (and checks), the
  // over/short, and the Z-report frozen onto the session. Manager or admin.
  app.post('/api/drawer/close', {
    schema: { body: { type: 'object', required: ['countedCashCents'], additionalProperties: false,
      properties: {
        countedCashCents: { type: 'integer', minimum: 0, maximum: 100_000_000 },
        countedChecksCents: { type: 'integer', minimum: 0, maximum: 100_000_000 },
        note: { type: 'string', maxLength: 500 },
      } } },
  }, async (req, reply) => {
    if (!requireRole(req, reply, 'manager')) return reply;
    const body = req.body as { countedCashCents: number; countedChecksCents?: number; note?: string };
    return refusable(reply, () => withTx(async (tx) => {
      const d = await openDrawer(tx);
      if (!d) throw new SalesError(409, 'No drawer is open');
      const z = await computeZReport(d, { cash: body.countedCashCents, checks: body.countedChecksCents ?? null }, tx);
      const [closed] = await tx.update(drawerSessions).set({
        status: 'closed', closedAt: new Date().toISOString(), closedBy: req.user!.id,
        expectedCashCents: z.cash.expectedCents, countedCashCents: body.countedCashCents, overShortCents: z.cash.overShortCents,
        expectedChecksCents: z.checks.expectedCents, countedChecksCents: body.countedChecksCents ?? null,
        checksOverShortCents: z.checks.overShortCents, closeNote: body.note ?? null, zReportJson: JSON.stringify(z),
      }).where(eq(drawerSessions.id, d.id)).returning();
      await audit(tx, req, { action: 'drawer.close', entity: 'drawer_session', entityId: d.id, before: d, after: closed });
      return drawerView(closed, tx);
    }));
  });

  // History, newest first: {rows, nextBefore} (Z-report JSON left out).
  app.get('/api/drawer', async (req) => {
    const q = req.query as { limit?: string; before?: string };
    const limit = pageLimit(q.limit);
    const rows = await db.select().from(drawerSessions)
      .where(q.before ? lt(drawerSessions.id, Number(q.before)) : undefined)
      .orderBy(desc(drawerSessions.id)).limit(limit + 1);
    const page = rows.slice(0, limit).map(({ zReportJson: _z, ...rest }) => rest);
    return { rows: page, nextBefore: rows.length > limit ? page[page.length - 1].id : null };
  });

  app.get('/api/drawer/:id', async (req, reply) => {
    const d = await drawerById(Number((req.params as { id: string }).id));
    if (!d) return reply.code(404).send({ error: 'Drawer session not found' });
    return drawerView(d);
  });

  app.get('/api/drawer/:id/z-report', async (req, reply) => {
    const d = await drawerById(Number((req.params as { id: string }).id));
    if (!d) return reply.code(404).send({ error: 'Drawer session not found' });
    const v = await drawerView(d);
    return { sessionId: v.id, status: v.status, final: v.final, openedAt: v.openedAt, openedByName: v.openedByName,
      closedAt: v.closedAt, closedByName: v.closedByName, ...v.zReport };
  });

  app.get('/api/drawer/:id/z-report.csv', async (req, reply) => {
    const d = await drawerById(Number((req.params as { id: string }).id));
    if (!d) return reply.code(404).send({ error: 'Drawer session not found' });
    reply.header('content-type', 'text/csv')
      .header('content-disposition', `attachment; filename="z-report-${d.id}.csv"`);
    return zReportCsv(await drawerView(d));
  });
}

async function drawerById(id: number) {
  const [d] = await db.select().from(drawerSessions).where(eq(drawerSessions.id, id));
  return d ?? null;
}
