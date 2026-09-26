import { describe, it, expect } from 'vitest';
import type { Material } from '../../../lib/types';
import type { JobDetail } from '../types';
import { buildPayload, draftFromJob, draftSig, newDraft, newLine, ticketTags, validate, type QuoteDraft } from './draft';
import { canColor, effectiveRoll, quoteMath } from './math';

const mat = (over: Partial<Material>): Material => ({
  id: 1, name: '651 vinyl', unit: 'sqft', costPerUnitCents: 100, laborFactorPct: 0, active: true,
  priceMode: 'per_inch_max', rateCents: 100, rate2Cents: null, minQty: 1, colorMultiplier: true,
  usesRoll: true, isAddon: false, archivedAt: null, ...over,
});
const vinyl = mat({});
const shirt = mat({ id: 2, name: 'T-shirt blank', priceMode: 'flat', rateCents: 800, usesRoll: false, isAddon: true, colorMultiplier: false });
const MATS = [vinyl, shirt];
const LEVELS = { 1: 5, 2: 10, 3: 15 };

function filled(over: Partial<QuoteDraft> = {}): QuoteDraft {
  const d = newDraft();
  return {
    ...d, title: 'Van doors', dueDate: '2030-03-12',
    customer: { id: 7, name: 'Acme', phone: '', email: '', level: 2 },
    lines: [newLine('decal', { materialId: 1, widthIn: '20', heightIn: '10', qty: '2', colorMult: 2 }),
      newLine('apparel', { materialId: 2, qty: '3' })],
    finalPrice: '100', ...over,
  };
}

describe('quoteMath', () => {
  it('prices each line on its own and sums the suggestion', () => {
    const m = quoteMath(filled(), MATS, 8.25, LEVELS);
    // 20in × $1 × 2 qty × 2 color = $80; shirt flat $8 × 3 (ignores color) = $24
    expect(m.lineSuggestions).toEqual([8000, 2400]);
    expect(m.suggested).toBe(10400);
    expect(m.override).toBe(true);
  });
  it('taxes, then takes the level discount after tax', () => {
    const m = quoteMath(filled({ applyDiscount: true }), MATS, 8.25, LEVELS);
    expect(m.taxCents).toBe(825);
    expect(m.discountPct).toBe(10);
    expect(m.discountCents).toBe(1083);
    expect(m.grandTotal).toBe(10000 + 825 - 1083);
  });
  it('no override when the price matches, none when nothing can be priced', () => {
    expect(quoteMath(filled({ finalPrice: '104' }), MATS, 8.25, LEVELS).override).toBe(false);
    const none = quoteMath(filled({ lines: [newLine('decal')] }), MATS, 8.25, LEVELS);
    expect(none.suggested).toBeNull();
    expect(none.override).toBe(false);
  });
  it('color and roll rules follow the material', () => {
    expect(canColor(shirt)).toBe(false);
    expect(canColor(mat({ priceMode: 'custom' }))).toBe(false);
    expect(effectiveRoll(newLine('decal', { widthIn: '20', heightIn: '10' }), vinyl)).toBeGreaterThan(0);
    expect(effectiveRoll(newLine('decal', { rollAuto: false, rollWidthIn: '48' }), vinyl)).toBe(48);
    expect(effectiveRoll(newLine('decal'), shirt)).toBeNull();
  });
});

describe('buildPayload', () => {
  it('maps line 0 to the job and the rest to items, with color tags from lines', () => {
    const d = filled({ tags: ['rush'] });
    const p = buildPayload(d, MATS, quoteMath(d, MATS, 8.25, LEVELS), { status: 'acknowledged' }) as Record<string, unknown>;
    expect(p).toMatchObject({ status: 'acknowledged', customerId: 7, materialId: 1, quantity: 2, widthIn: 20, heightIn: 10,
      mainColorMult: 2, suggestedPriceCents: 10400, finalPriceCents: 10000, tags: 'rush, 2 color', discountPct: 0 });
    expect(p.items).toEqual([{ type: 'apparel', title: 'T-shirt blank', qty: 3, priceCents: 800, colorMult: 1, materialId: 2 }]);
  });
  it('sends a new customer inline, and leaves out locked fields on an invoiced job', () => {
    const d = filled({ customer: { id: null, name: 'New Co', phone: '(555) 111 - 2222', email: 'a@b.co', level: 0 } });
    const m = quoteMath(d, MATS, 8.25, LEVELS);
    expect(buildPayload(d, MATS, m)).toMatchObject({ newCustomer: { name: 'New Co', email: 'a@b.co' } });
    const locked = buildPayload(d, MATS, m, { locked: true }) as Record<string, unknown>;
    expect(Object.keys(locked).sort()).toEqual(['dueDate', 'fileRef', 'notes', 'tags', 'title', 'type', 'useProofFlow']);
  });
});

describe('validate / draftFromJob', () => {
  it('requires phone + email only for a new customer', () => {
    expect(validate(filled())).toBeNull();
    expect(validate(filled({ customer: { id: null, name: 'X', phone: '', email: '', level: 0 } }))).toMatch(/phone/);
    expect(validate(filled({ customer: { id: null, name: 'X', phone: '(555) 111 - 2222', email: 'nope', level: 0 } }))).toMatch(/email/);
    expect(validate(filled({ finalPrice: '4.555' }))).toMatch(/price/);
    expect(validate(filled({ lines: [newLine('decal')] }))).toMatch(/material/);
  });
  it('round-trips a saved job and keeps color tags derived', () => {
    const job = {
      id: 3, title: 'Van doors', type: 'decal', dueDate: '2030-03-12', customerId: 7, customerName: 'Acme', customerPhone: null,
      customerLevel: 2, materialId: 1, widthIn: 20, heightIn: 10, quantity: 2, rollWidthIn: null, mainColorMult: 2,
      tags: 'rush, 2 color', useProofFlow: false, finalPriceCents: 10000, taxable: true, discountPct: 10, notes: null, fileRef: null,
      items: [{ id: 1, jobId: 3, type: 'apparel', title: 'Shirt', qty: 3, priceCents: 800, materialId: 2, widthIn: null, heightIn: null, fileRef: null, rollWidthIn: null, colorMult: 1 }],
    } as unknown as JobDetail;
    const d = draftFromJob(job);
    expect(d.tags).toEqual(['rush']);
    expect(ticketTags(d)).toEqual(['rush', '2 color']);
    expect(d.applyDiscount).toBe(true);
    expect(d.customer.level).toBe(2);
    expect(draftSig(draftFromJob(job))).toBe(draftSig(d));
    expect(draftSig({ ...d, notes: 'x' })).not.toBe(draftSig(d));
  });
});
