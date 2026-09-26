// Pure dashboard logic (tested in logic.test.ts).
import { CUSTOM_ACCENTS } from '../../../shared/domain';

/** yyyy-mm-dd in the shop's local time (not UTC — a job due today stays "today" after 7pm). */
export function localIsoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type DueState = 'overdue' | 'today' | 'soon';

/** A due date against today: overdue, today, or coming up (the server picks which jobs). */
export function dueState(dueDate: string, today: string): DueState {
  return dueDate < today ? 'overdue' : dueDate === today ? 'today' : 'soon';
}

/** Stable color per tag, from the accent list (used as a dot, never behind text). */
export function tagColor(tag: string): string {
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return CUSTOM_ACCENTS[h % CUSTOM_ACCENTS.length];
}

export const splitTags = (tags: string | null) => (tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);
