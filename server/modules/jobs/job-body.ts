// Job request shapes and helpers shared by the jobs route files.
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { jobs } from '../../db/schema/index.js';
import { approvalSchema } from '../auth/index.js';
import { JOB_TYPES } from '../../../shared/domain.js';
import { baseQuery, liveItems } from './queries.js';

/** Fields an invoice snapshots: once a job is invoiced they can't change
 *  (void or return instead — ADR 0007). */
export const LOCKED_KEYS = ['finalPriceCents', 'suggestedPriceCents', 'taxable', 'discountPct', 'totalCents', 'customerId',
  'materialId', 'widthIn', 'heightIn', 'quantity', 'mainColorMult'] as const;
const ITEM_KEYS = ['type', 'title', 'qty', 'priceCents', 'materialId', 'widthIn', 'heightIn', 'colorMult'] as const;
export const itemSig = (items: Record<string, unknown>[]) =>
  JSON.stringify(items.map((it) => ITEM_KEYS.map((k) => it[k] ?? (k === 'colorMult' ? 1 : null))));

export const createBody = {
  type: 'object',
  required: ['clientRef', 'type', 'title', 'status', 'finalPriceCents'],
  additionalProperties: false,
  properties: {
    clientRef: { type: 'string', minLength: 8, maxLength: 64 },
    customerId: { type: 'integer' },
    newCustomer: {
      type: 'object',
      // Email is required for every new customer entered by a person
      // (2026-07-02). A customer created via POST /api/customers named
      // "Walk-in" carries the exemption.
      required: ['name', 'email'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 120 },
        phone: { type: 'string', maxLength: 40 },
        email: { type: 'string', minLength: 3, maxLength: 120, pattern: '^\\S+@\\S+\\.\\S+$' },
      },
    },
    type: { type: 'string', enum: [...JOB_TYPES] },
    title: { type: 'string', minLength: 1, maxLength: 200 },
    status: { type: 'string', enum: ['quote', 'acknowledged'] },
    useProofFlow: { type: 'boolean' },
    dueDate: { type: 'string', maxLength: 10 },
    quantity: { type: 'integer', minimum: 1 },
    widthIn: { type: 'number', exclusiveMinimum: 0 },
    heightIn: { type: 'number', exclusiveMinimum: 0 },
    mainColorMult: { type: 'integer', minimum: 1, maximum: 3 },
    rollWidthIn: { type: 'number', exclusiveMinimum: 0 },
    tags: { type: 'string', maxLength: 300 },
    fileRef: { type: 'string', maxLength: 400 },
    taxable: { type: 'boolean' },
    discountPct: { type: 'number', minimum: 0, maximum: 100 },
    totalCents: { type: 'integer', minimum: 0 },
    items: { type: 'array', maxItems: 30, items: { type: 'object',
      required: ['type', 'title', 'qty', 'priceCents'], additionalProperties: false,
      properties: {
        type: { type: 'string', enum: [...JOB_TYPES] },
        title: { type: 'string', minLength: 1, maxLength: 200 },
        materialId: { type: 'integer' },
        widthIn: { type: 'number', exclusiveMinimum: 0 },
        heightIn: { type: 'number', exclusiveMinimum: 0 },
        rollWidthIn: { type: 'number', exclusiveMinimum: 0 },
        colorMult: { type: 'integer', minimum: 1, maximum: 3 },
        qty: { type: 'integer', minimum: 1 },
        priceCents: { type: 'integer', minimum: 0 },
      } } },
    materialId: { type: 'integer' },
    suggestedPriceCents: { type: 'integer', minimum: 0 },
    finalPriceCents: { type: 'integer', minimum: 0 },
    notes: { type: 'string', maxLength: 2000 },
    approval: approvalSchema, // price override (ADR 0007)
  },
} as const;

export interface CreateJobBody {
  clientRef: string;
  customerId?: number;
  newCustomer?: { name: string; phone?: string; email: string };
  type: string;
  title: string;
  status: 'quote' | 'acknowledged';
  useProofFlow?: boolean;
  dueDate?: string;
  quantity?: number;
  widthIn?: number;
  heightIn?: number;
  mainColorMult?: number;
  rollWidthIn?: number;
  tags?: string;
  fileRef?: string;
  taxable?: boolean;
  discountPct?: number;
  totalCents?: number;
  items?: { type: string; title: string; materialId?: number; widthIn?: number; heightIn?: number; rollWidthIn?: number; colorMult?: number; qty: number; priceCents: number }[];
  materialId?: number;
  suggestedPriceCents?: number;
  finalPriceCents: number;
  notes?: string;
}

export type ItemInput = NonNullable<CreateJobBody['items']>[number];

export const itemRow = (jobId: number, it: ItemInput) => ({
  jobId, type: it.type, title: it.title, qty: it.qty, priceCents: it.priceCents,
  materialId: it.materialId ?? null, widthIn: it.widthIn ?? null, heightIn: it.heightIn ?? null,
  rollWidthIn: it.rollWidthIn ?? null, colorMult: it.colorMult ?? 1,
});

/** The job as every endpoint returns it (read-model + live lines). */
export async function jobWithItems(id: number, dbx: Db) {
  const [row] = await baseQuery(dbx).where(eq(jobs.id, id)).limit(1);
  return row ? { ...row, items: await liveItems(id, dbx) } : null;
}
