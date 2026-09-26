// A blind count in progress, kept in this browser (localStorage) so a dropped
// wifi connection or a reloaded tablet never loses what was counted.
import { parseWhole } from '../logic';

export interface DraftLine { counted: string; name: string; countUnit: string | null; categoryId: number | null }
export interface Draft {
  lines: Record<number, DraftLine>;
  reasons: Record<number, string>;
  notes: Record<number, string>;
  /** Next count date (yyyy-mm-dd), '' = server default (+7 days). */
  next: string;
}

export const emptyDraft = (): Draft => ({ lines: {}, reasons: {}, notes: {}, next: '' });
const key = (countId: number) => `dp-count-draft-${countId}`;

export function loadDraft(countId: number): Draft {
  try {
    const raw = localStorage.getItem(key(countId));
    const d = raw ? JSON.parse(raw) : null;
    return d && typeof d === 'object' && d.lines ? { ...emptyDraft(), ...d } : emptyDraft();
  } catch { return emptyDraft(); }
}
export function saveDraft(countId: number, d: Draft) {
  try { localStorage.setItem(key(countId), JSON.stringify(d)); } catch { /* storage full/blocked — keep going in memory */ }
}
export function clearDraft(countId: number) {
  try { localStorage.removeItem(key(countId)); } catch { /* ignore */ }
}

/** Items with a valid count typed in (blank = skipped this time). */
export function enteredIds(d: Draft): number[] {
  return Object.entries(d.lines).filter(([, l]) => parseWhole(l.counted) != null).map(([id]) => Number(id));
}

/** How many entered items belong to a category (null = uncategorized). */
export function enteredIn(d: Draft, categoryId: number | null): number {
  return Object.values(d.lines).filter((l) => l.categoryId === categoryId && parseWhole(l.counted) != null).length;
}

/** The submit payload: one row per entered item, reason/note only where given. */
export function submitCounts(d: Draft) {
  return enteredIds(d).map((itemId) => ({
    itemId, counted: parseWhole(d.lines[itemId].counted)!,
    ...(d.reasons[itemId] ? { reasonCode: d.reasons[itemId] } : {}),
    ...(d.notes[itemId]?.trim() ? { note: d.notes[itemId].trim() } : {}),
  }));
}

/** Split ids into chunks the list endpoint accepts (ids= takes up to 200). */
export function chunks<T>(xs: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
