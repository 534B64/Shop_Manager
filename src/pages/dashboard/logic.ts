// Pure dashboard logic (tested in logic.test.ts).
import { CUSTOM_ACCENTS } from '../../../shared/domain';
import type { Job } from '../../lib/types';

/** yyyy-mm-dd in the shop's local time (not UTC — a job due today stays "today" after 7pm). */
export function localIsoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type DueState = 'overdue' | 'today' | 'soon';

/** Open jobs due within `days` (overdue included), soonest first. */
export function dueSoon(jobs: Job[], now: Date, days = 7): (Job & { due: DueState })[] {
  const today = localIsoDate(now);
  const until = localIsoDate(new Date(now.getTime() + days * 86400000));
  return jobs
    .filter((j) => j.status !== 'picked_up' && j.status !== 'done' && j.dueDate && j.dueDate <= until)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : 0))
    .map((j) => ({ ...j, due: j.dueDate! < today ? 'overdue' : j.dueDate === today ? 'today' : 'soon' }));
}

/** Stable color per tag, from the accent list (used as a dot, never behind text). */
export function tagColor(tag: string): string {
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return CUSTOM_ACCENTS[h % CUSTOM_ACCENTS.length];
}

export const splitTags = (tags: string | null) => (tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);
