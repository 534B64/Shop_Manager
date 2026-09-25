// Job read-model: the joined select every jobs endpoint returns.
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { jobs, customers, materials } from '../../db/schema/index.js';

const jobSelect = {
  id: jobs.id,
  clientRef: jobs.clientRef,
  customerId: jobs.customerId,
  po: jobs.po,
  tags: jobs.tags,
  fileRef: jobs.fileRef,
  createdBy: jobs.createdBy,
  rollWidthIn: jobs.rollWidthIn,
  customerName: customers.name,
  customerPhone: customers.phone,
  type: jobs.type,
  title: jobs.title,
  status: jobs.status,
  useProofFlow: jobs.useProofFlow,
  dueDate: jobs.dueDate,
  quantity: jobs.quantity,
  widthIn: jobs.widthIn,
  heightIn: jobs.heightIn,
  mainColorMult: jobs.mainColorMult,
  materialId: jobs.materialId,
  materialName: materials.name,
  materialCostSnapshotCents: jobs.materialCostSnapshotCents,
  taxable: jobs.taxable,
  discountPct: jobs.discountPct,
  totalCents: jobs.totalCents,
  suggestedPriceCents: jobs.suggestedPriceCents,
  finalPriceCents: jobs.finalPriceCents,
  notes: jobs.notes,
  createdAt: jobs.createdAt,
};

export function baseQuery() {
  return db
    .select(jobSelect)
    .from(jobs)
    .leftJoin(customers, eq(jobs.customerId, customers.id))
    .leftJoin(materials, eq(jobs.materialId, materials.id));
}
