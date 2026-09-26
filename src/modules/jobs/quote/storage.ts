// Draft autosave (sketchy-wifi rule): the new-quote form and any unsaved edit
// to a saved job survive a reload, a dropped connection or a closed tab.
// Browser storage can be missing or full — every call is best effort.
import { newDraft, newLine, type QuoteDraft } from './draft';

const NEW_KEY = 'dp-erp-quote-draft';
const jobKey = (id: number) => `dp-erp-job-draft:${id}`;

function read(key: string): QuoteDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = { ...newDraft(), ...JSON.parse(raw) } as QuoteDraft;
    // Drafts saved before lines existed (old Quotes page) start with a fresh main line.
    if (!Array.isArray(d.lines) || d.lines.length === 0) d.lines = [newLine(d.type)];
    return d;
  } catch { return null; }
}
function write(key: string, d: QuoteDraft | null) {
  try { if (d) localStorage.setItem(key, JSON.stringify(d)); else localStorage.removeItem(key); } catch { /* full / blocked */ }
}

export const loadNewDraft = (): QuoteDraft => read(NEW_KEY) ?? newDraft();
export const saveNewDraft = (d: QuoteDraft) => write(NEW_KEY, d);
export const clearNewDraft = () => write(NEW_KEY, null);

export const loadJobDraft = (id: number) => read(jobKey(id));
export const saveJobDraft = (id: number, d: QuoteDraft) => write(jobKey(id), d);
export const clearJobDraft = (id: number) => write(jobKey(id), null);
