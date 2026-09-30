// The company name for the UI, from GET /api/auth/status (public, so the sign-in
// screen has it too). One shared copy; Settings → Shop updates it after a save.
import { useEffect, useSyncExternalStore } from 'react';
import { brandName } from '../../shared/branding';

let company = '';
let started = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function apply(name: string) {
  company = name;
  document.title = brandName(name);
  emit();
}

/** Read the name once per page load; safe to call from anywhere. */
export function loadCompanyName(force = false) {
  if (started && !force) return;
  started = true;
  fetch('/api/auth/status').then((r) => (r.ok ? r.json() : null))
    .then((s: { companyName?: string } | null) => { if (s && typeof s.companyName === 'string') apply(s.companyName); })
    .catch(() => { started = false; /* offline: try again on the next mount */ });
}

/** After an admin saves a new name. */
export const setCompanyName = apply;

/** The current company name ('' when none is set); loads it on first use. */
export function useCompanyName(): string {
  useEffect(() => { loadCompanyName(); }, []);
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => company);
}
