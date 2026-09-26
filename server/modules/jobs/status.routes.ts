// Job lifecycle moves: status changes (pickup invoices the job) and Quote → Order.
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { withTx } from '../../db/index.js';
import { jobs } from '../../db/schema/index.js';
import { owedCents, openDrawer } from '../payments/index.js';
import { invoiceJob } from '../sales/index.js';
import { requireApproval, approvalSchema } from '../auth/index.js';
import { audit } from '../audit/index.js';
import type { JobStatus } from '../../../shared/domain.js';
import { canTransition } from '../../../shared/statusFlow.js';
import { baseQuery } from './queries.js';

export async function jobStatusRoutes(app: FastifyInstance) {
  // Move a job along its lifecycle (one step forward or back).
  app.put('/api/jobs/:id/status', {
    schema: { body: { type: 'object', required: ['status'], additionalProperties: false,
      properties: {
        status: { type: 'string' },
        // Unpaid pickup: the client first gets a 402 with the balance, confirms,
        // then retries with override:true (+ approval when a cashier asks).
        override: { type: 'boolean' },
        approval: approvalSchema,
      } } },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const to = (req.body as { status: string }).status as JobStatus;
    return withTx(async (tx) => {
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, id));
      if (!job) return reply.code(404).send({ error: 'Job not found' });
      if (!canTransition(job.status as JobStatus, to, job.useProofFlow)) {
        return reply.code(409).send({ error: `Cannot move from '${job.status}' to '${to}'` });
      }
      const patch: Record<string, unknown> = { status: to };
      let approvalId: number | null = null;
      // No pickup without payment — unless a manager approves the override.
      if (to === 'picked_up') {
        const owed = await owedCents(job, tx);
        if (owed > 0) {
          const { override } = req.body as { override?: boolean };
          if (!override) {
            return reply.code(402).send({ error: `Balance due: ${(owed / 100).toFixed(2)}. Manager override required.`, owedCents: owed });
          }
          const approver = await requireApproval(req, reply, { action: 'job.pickup_unpaid', entity: 'job', entityId: id,
            details: { owedCents: owed } });
          if (!approver) return reply;
          approvalId = approver.approvalId;
          // Attributable line — appended to the job's notes so it's visible
          // wherever the job is, and survives in the same backup as the books.
          // The approvals row is the authoritative record.
          const who = approver.id === req.user!.id ? approver.name : `${approver.name} (for ${req.user!.name})`;
          const line = `[${new Date().toISOString().slice(0, 10)}] Picked up with ${(owed / 100).toFixed(2)} balance due — manager override by ${who}.`;
          patch.notes = job.notes ? `${job.notes}\n${line}` : line;
          req.log.warn({ jobId: id, owedCents: owed, approvedBy: approver.name }, 'pickup-with-balance-due manager override');
        }
      }
      await tx.update(jobs).set(patch).where(eq(jobs.id, id));
      await audit(tx, req, { action: 'job.status', entity: 'job', entityId: id,
        before: { status: job.status }, after: patch, approvalId });
      // Picked up = sold: issue the invoice now if paying in full hasn't already.
      // A $0 job (warranty redo, freebie) takes no invoice number.
      if (to === 'picked_up' && (job.totalCents ?? job.finalPriceCents ?? 0) > 0) {
        const drawer = await openDrawer(tx);
        await invoiceJob(tx, req, id, drawer?.id ?? null);
      }
      const [row] = await baseQuery(tx).where(eq(jobs.id, id)).limit(1);
      return row;
    });
  });

  // Quote → Order. Phase 2 owns the full status board; this is the Phase 1 hand-off.
  app.post('/api/jobs/:id/convert', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    return withTx(async (tx) => {
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, id));
      if (!job) return reply.code(404).send({ error: 'Job not found' });
      if (job.status !== 'quote') {
        return reply.code(409).send({ error: `Cannot convert a job in status '${job.status}'` });
      }
      // Proof-flow jobs go to 'approved' (design comes next); simple jobs go straight to 'order'.
      const next = job.useProofFlow ? 'approved' : 'acknowledged';
      await tx.update(jobs).set({ status: next }).where(eq(jobs.id, id));
      await audit(tx, req, { action: 'job.convert', entity: 'job', entityId: id,
        before: { status: job.status }, after: { status: next } });
      const [row] = await baseQuery(tx).where(eq(jobs.id, id)).limit(1);
      return row;
    });
  });
}
