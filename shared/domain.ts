// Domain constants shared by client and server.

export const JOB_TYPES = ['decal', 'sign', 'apparel', 'magnet', 'retail', 'other'] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  decal: 'Decal / Vinyl',
  sign: 'Sign / Large Format',
  apparel: 'Apparel (Heat Press)',
  magnet: 'Magnet Plate',
  retail: 'Retail',
  other: 'Other',
};

export const PRESET_TAGS = ['rush', '2 color', '3 color', 'tshirt provided', 'due later'] as const;

/** Accent choices for the Custom theme. */
export const CUSTOM_ACCENTS = ['#2456c4', '#178a4c', '#6d3bbf', '#c03232', '#0e8a8a'] as const;

// Default simple lifecycle. The proof flow adds quote/approved/design up front.
export const SIMPLE_STATUSES = ['acknowledged', 'in_progress', 'done', 'picked_up'] as const;
export const PROOF_STATUSES = [
  'quote',
  'approved',
  'design',
  'in_progress',
  'done',
  'picked_up',
] as const;

export type JobStatus = (typeof PROOF_STATUSES)[number] | (typeof SIMPLE_STATUSES)[number];

export const STATUS_LABELS: Record<JobStatus, string> = {
  quote: 'Quote',
  approved: 'Approved',
  design: 'Design',
  acknowledged: 'Acknowledged',
  in_progress: 'In Progress',
  done: 'Done',
  picked_up: 'Picked Up',
};

/** Standard vinyl roll widths (inches). */
export const ROLL_SIZES = [15, 24, 30, 48] as const;

export const PRICE_MODES = ['per_inch_max', 'per_sqft', 'per_unit', 'flat', 'custom'] as const;
export type PriceMode = (typeof PRICE_MODES)[number];

export const PRICE_MODE_LABELS: Record<PriceMode, string> = {
  per_inch_max: 'Per inch (longest side)',
  per_sqft: 'Per sq ft',
  per_unit: 'Per unit',
  flat: 'Flat base per piece',
  custom: 'Custom (no suggestion)',
};

/** Default sales tax rate (%). Single source of truth for client and server. */
export const DEFAULT_TAX_RATE_PCT = 8.25;

export const MATERIAL_UNITS = ['sqft', 'each', 'sheet', 'linear_ft'] as const;
export type MaterialUnit = (typeof MATERIAL_UNITS)[number];

// Phase 10: units become admin-managed (settings-backed list), so materials'
// `unit` field is now a free string validated by length, not this enum. This
// is the seed/fallback list used until the admin edits it via Settings ->
// Inventory Settings ("Add" persists the whole array to /api/settings/units).
export const DEFAULT_UNIT_TYPES = ['sqft', 'each', 'sheet', 'linear_ft', 'roll'] as const;

export const THEMES = ['light', 'dark', 'minimal'] as const;
export type Theme = (typeof THEMES)[number];

// ---- Inventory adjustment reasons (extended 2026-07-07) ----
// The original five stay valid; 'sold' is the counter-sale deduction, and the
// rest are the cycle-count variance reason codes (required, server-enforced,
// when a count variance beats the configured threshold — 'correction' doubles
// as the miscount/correction code, 'damaged' was already present).
export const ADJUST_REASONS = [
  'received', 'used', 'sold', 'damaged', 'cycle_count', 'correction',
  'production_use', 'waste_scrap', 'theft_loss', 'receiving_error', 'other',
] as const;
export type AdjustReason = (typeof ADJUST_REASONS)[number];

/** The reason codes a variance-review screen offers (a subset of ADJUST_REASONS). */
export const VARIANCE_REASON_CODES = [
  'production_use', 'waste_scrap', 'correction', 'damaged',
  'theft_loss', 'receiving_error', 'other',
] as const;
export type VarianceReasonCode = (typeof VARIANCE_REASON_CODES)[number];

// ---- Inventory transaction types (Phase 2, ADR 0006) ----
// Every on-hand change is one inventory transaction of one of these types.
// 'production' exists as a TYPE only — there is no production-consumption
// workflow (the weekly cycle count stays the reconciler, see CLAUDE.md).
export const TXN_TYPES = [
  'receipt', 'sale', 'return', 'adjustment', 'transfer_out', 'transfer_in',
  'production', 'count', 'opening',
] as const;
export type TxnType = (typeof TXN_TYPES)[number];
/** Types whose rows must carry a real reason code. */
export const TXN_TYPES_NEEDING_REASON: readonly TxnType[] = ['adjustment', 'count', 'production'];

export const TXN_TYPE_LABELS: Record<TxnType, string> = {
  receipt: 'Receipt', sale: 'Sale', return: 'Return', adjustment: 'Adjustment',
  transfer_out: 'Transfer out', transfer_in: 'Transfer in', production: 'Production',
  count: 'Cycle count', opening: 'Opening balance',
};

/** Which transaction type a manual /adjust reason books as. */
export function txnTypeForReason(reason: AdjustReason): TxnType {
  if (reason === 'received') return 'receipt';
  if (reason === 'sold') return 'sale';
  if (reason === 'used' || reason === 'production_use') return 'production';
  return 'adjustment';
}

export const ADJUST_REASON_LABELS: Record<AdjustReason, string> = {
  received: 'Received',
  used: 'Used',
  sold: 'Sold (counter sale)',
  damaged: 'Damaged',
  cycle_count: 'Cycle count',
  correction: 'Miscount / correction',
  production_use: 'Production use (untracked)',
  waste_scrap: 'Waste / scrap',
  theft_loss: 'Theft / loss suspected',
  receiving_error: 'Receiving error',
  other: 'Other',
};
