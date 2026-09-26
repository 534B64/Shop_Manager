// The quote/order form's state and how it maps to and from the jobs API.
// Pure — tested in draft.test.ts. Line 0 is the main item (the job's own
// columns); lines 1… are the additional items (job_items).
import type { Material } from '../../../lib/types';
import { isValidEmail, isValidPhone, parseDollarsToCents } from '../../../lib/format';
import type { JobDetail } from '../types';
import { effectiveRoll, type QuoteMath } from './math';
import { newRef } from '../../../lib/ref';

export interface LineDraft {
  key: string;
  type: string; title: string; materialId: number | null;
  widthIn: string; heightIn: string; qty: string;
  rollWidthIn: string; rollAuto: boolean;
  /** Color multiplier (the 2/3-color price tag) — this line only. */
  colorMult: number;
  /** Vinyl color (a material variant) — only picks the roll SKU to stock-check; never changes price. */
  materialColor: string;
}

export interface CustomerDraft { id: number | null; name: string; phone: string; email: string; level: number }

export interface QuoteDraft {
  clientRef: string;
  title: string; type: string; dueDate: string;
  customer: CustomerDraft;
  lines: LineDraft[];
  tags: string[];
  useProofFlow: boolean;
  finalPrice: string; taxable: boolean; applyDiscount: boolean;
  notes: string; fileRef: string;
}

export const COLOR_TAGS = ['2 color', '3 color'];
export const colorTag = (m: number): string | null => (m >= 3 ? '3 color' : m >= 2 ? '2 color' : null);

const uid = newRef;

export const newLine = (type: string, over: Partial<LineDraft> = {}): LineDraft => ({
  key: uid(), type, title: '', materialId: null, widthIn: '', heightIn: '', qty: '1',
  rollWidthIn: '', rollAuto: true, colorMult: 1, materialColor: '', ...over,
});

export const emptyCustomer = (): CustomerDraft => ({ id: null, name: '', phone: '', email: '', level: 0 });

export const newDraft = (): QuoteDraft => ({
  clientRef: uid(), title: '', type: 'decal', dueDate: '',
  customer: emptyCustomer(), lines: [newLine('decal')], tags: [], useProofFlow: false,
  finalPrice: '', taxable: true, applyDiscount: false, notes: '', fileRef: '',
});

const str = (n: number | null | undefined) => (n == null ? '' : String(n));

/** The form as it stands for a saved job (server truth). */
export function draftFromJob(j: JobDetail): QuoteDraft {
  return {
    clientRef: uid(), title: j.title, type: j.type, dueDate: j.dueDate ?? '',
    customer: { id: j.customerId, name: j.customerName ?? '', phone: j.customerPhone ?? '', email: '', level: j.customerLevel ?? 0 },
    lines: [
      newLine(j.type, { materialId: j.materialId, widthIn: str(j.widthIn), heightIn: str(j.heightIn), qty: String(j.quantity),
        rollWidthIn: str(j.rollWidthIn), rollAuto: j.rollWidthIn == null, colorMult: j.mainColorMult ?? 1 }),
      ...j.items.map((it) => newLine(it.type, { title: it.title, materialId: it.materialId, widthIn: str(it.widthIn),
        heightIn: str(it.heightIn), qty: String(it.qty), rollWidthIn: str(it.rollWidthIn), rollAuto: it.rollWidthIn == null,
        colorMult: it.colorMult ?? 1 })),
    ],
    tags: (j.tags ?? '').split(',').map((t) => t.trim()).filter((t) => t && !COLOR_TAGS.includes(t)),
    useProofFlow: j.useProofFlow,
    finalPrice: j.finalPriceCents != null ? (j.finalPriceCents / 100).toFixed(2) : '',
    taxable: j.taxable, applyDiscount: (j.discountPct ?? 0) > 0,
    notes: j.notes ?? '', fileRef: j.fileRef ?? '',
  };
}

/** Comparable form content (ignores the random keys) — "are there unsaved changes?". */
export function draftSig(d: QuoteDraft): string {
  const { clientRef: _c, lines, ...rest } = d;
  return JSON.stringify({ ...rest, lines: lines.map(({ key: _k, ...l }) => l) });
}

/** Ticket tags: the chosen tags plus a color tag for every line that carries one. */
export function ticketTags(d: QuoteDraft): string[] {
  const colors = new Set<string>();
  for (const l of d.lines) { const t = colorTag(l.colorMult); if (t) colors.add(t); }
  return [...d.tags, ...colors];
}

export function validate(d: QuoteDraft): string | null {
  const main = d.lines[0];
  if (!d.customer.name.trim()) return 'Pick a customer, or type a new one.';
  if (!d.customer.id && !isValidPhone(d.customer.phone)) return 'A full 10-digit phone number is required for new customers.';
  if (!d.customer.id && !isValidEmail(d.customer.email)) return 'An email address is required for new customers.';
  if (!d.title.trim()) return 'Job title is required.';
  if (!d.dueDate) return 'Due date is required.';
  if (!main?.materialId) return 'Pick a material / price rule for the main item.';
  if (!(Number(main.qty) > 0)) return 'Quantity is required.';
  if (parseDollarsToCents(d.finalPrice) === null) return 'Enter a valid price (e.g. 45 or 45.00).';
  return null;
}

const pos = (s: string) => (Number(s) > 0 ? Number(s) : undefined);
const byId = (materials: Material[], id: number | null) => materials.find((m) => m.id === id) ?? null;

/**
 * Body for POST /api/jobs (with `status`) or PUT /api/jobs/:id (without).
 * `locked` (the job is invoiced) leaves out every field the invoice fixed.
 */
export function buildPayload(d: QuoteDraft, materials: Material[], math: QuoteMath, opts: { status?: 'quote' | 'acknowledged'; locked?: boolean } = {}) {
  const tags = ticketTags(d);
  const common = {
    type: d.type, title: d.title.trim(), useProofFlow: d.useProofFlow,
    ...(d.dueDate ? { dueDate: d.dueDate } : {}),
    tags: tags.join(', '), notes: d.notes.trim(), fileRef: d.fileRef.trim(),
    ...(opts.status ? { status: opts.status } : {}),
  };
  if (opts.locked) return common;
  const [main, ...items] = d.lines;
  const mainRoll = effectiveRoll(main, byId(materials, main.materialId));
  return {
    ...common,
    ...(d.customer.id ? { customerId: d.customer.id }
      : { newCustomer: { name: d.customer.name.trim(), phone: d.customer.phone.trim(), email: d.customer.email.trim() } }),
    quantity: Number(main.qty) || 1,
    ...(pos(main.widthIn) ? { widthIn: pos(main.widthIn) } : {}),
    ...(pos(main.heightIn) ? { heightIn: pos(main.heightIn) } : {}),
    mainColorMult: main.colorMult,
    ...(mainRoll ? { rollWidthIn: mainRoll } : {}),
    ...(main.materialId ? { materialId: main.materialId } : {}),
    ...(math.suggested != null ? { suggestedPriceCents: math.suggested } : {}),
    finalPriceCents: parseDollarsToCents(d.finalPrice) ?? 0,
    taxable: d.taxable,
    discountPct: math.discountPct,
    totalCents: math.grandTotal,
    // A line with no description takes its material's name; a blank line is dropped.
    items: items.map((it, i) => ({ it, s: math.lineSuggestions[i + 1], m: byId(materials, it.materialId) }))
      .filter(({ it, m }) => it.title.trim() || m)
      .map(({ it, s, m }) => {
        const roll = effectiveRoll(it, m);
        return {
          type: it.type, title: it.title.trim() || m!.name, qty: Number(it.qty) || 1,
          // Per-piece price from the line's suggestion (0 = custom, priced in the main Price).
          priceCents: s != null ? Math.round(s / (Number(it.qty) || 1)) : 0,
          colorMult: it.colorMult,
          ...(it.materialId ? { materialId: it.materialId } : {}),
          ...(pos(it.widthIn) ? { widthIn: pos(it.widthIn) } : {}),
          ...(pos(it.heightIn) ? { heightIn: pos(it.heightIn) } : {}),
          ...(roll ? { rollWidthIn: roll } : {}),
        };
      }),
  };
}
