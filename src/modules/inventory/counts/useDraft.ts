import { useEffect, useState } from 'react';
import { loadDraft, saveDraft, type Draft } from './draft';

/** The count draft for one session, saved to this browser on every change. */
export function useDraft(countId: number) {
  const [draft, setDraft] = useState<Draft>(() => loadDraft(countId));
  useEffect(() => { setDraft(loadDraft(countId)); }, [countId]);
  useEffect(() => { saveDraft(countId, draft); }, [countId, draft]);
  return [draft, setDraft] as const;
}
