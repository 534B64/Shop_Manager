// Pure helpers for the audit viewer (tested in logic.test.ts).

export interface AuditRow {
  id: number; at: string; userId: number | null; action: string; entity: string; entityId: string | null;
  beforeJson: string | null; afterJson: string | null; approvalId: number | null; requestId: string | null;
}
export interface ApprovalRow {
  id: number; createdAt: string; action: string; entity: string; entityId: string | null; reason: string | null;
  details: string | null; requestedBy: number; requestedByName: string | null; approvedBy: number; approvedByName: string | null;
}

/** Stored JSON → indented text for a <pre> (never HTML). Bad JSON shows as-is. */
export function prettyJson(raw: string | null): string {
  if (raw == null) return '—';
  try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
}

/** Top-level keys whose value differs between before and after. */
export function changedKeys(before: string | null, after: string | null): string[] {
  const parse = (s: string | null): Record<string, unknown> => {
    try { const v = s ? JSON.parse(s) : null; return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
  };
  const a = parse(before), b = parse(after);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();
}

export const ENTITIES = ['category', 'category_size', 'counter_sale', 'customer', 'cycle_count', 'drawer_session',
  'inventory_item', 'invoice', 'job', 'location', 'material', 'material_color', 'payment', 'return', 'setting',
  'supplier', 'user'] as const;

export const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
