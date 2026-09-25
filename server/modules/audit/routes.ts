import type { FastifyInstance } from 'fastify';
import { requireRole } from '../auth/index.js';
import { listAudit, allAudit, type AuditQuery } from './service.js';

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseQuery(raw: Record<string, string | undefined>): AuditQuery {
  return {
    entity: raw.entity || undefined,
    entityId: raw.entityId || undefined,
    userId: raw.userId ? Number(raw.userId) : undefined,
    from: raw.from || undefined,
    to: raw.to || undefined,
    before: raw.before ? Number(raw.before) : undefined,
    limit: raw.limit ? Number(raw.limit) : undefined,
  };
}

// Admin only. No UI page yet (a later phase builds it).
export async function auditRoutes(app: FastifyInstance) {
  // ?entity=&entityId=&userId=&from=&to=&limit=(≤200)&before=<id cursor>
  app.get('/api/audit', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    return listAudit(parseQuery(req.query as Record<string, string | undefined>));
  });

  app.get('/api/audit.csv', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return reply;
    const { before: _b, limit: _l, ...filters } = parseQuery(req.query as Record<string, string | undefined>);
    const rows = await allAudit(filters);
    const header = 'id,at,user_id,action,entity,entity_id,approval_id,request_id,before_json,after_json';
    const lines = rows.map((r) =>
      [r.id, r.at, r.userId ?? '', r.action, r.entity, csvEscape(r.entityId), r.approvalId ?? '',
       csvEscape(r.requestId), csvEscape(r.beforeJson), csvEscape(r.afterJson)].join(','));
    reply.header('content-type', 'text/csv').header('content-disposition', 'attachment; filename="audit-log.csv"');
    return [header, ...lines].join('\n');
  });
}
