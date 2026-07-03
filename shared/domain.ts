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
