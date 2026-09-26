// The sale in progress survives a trip to another page (e.g. to open the
// drawer) in this browser tab. The clientRef lives with the cart: one sale,
// one ref, so a retry after a dropped connection can never charge twice.
import { useEffect, useState } from 'react';
import type { CartLine, TaxExemption } from './cart';
import type { PickedCustomer } from '../lib/CustomerPicker';
import { newRef } from '../../../lib/ref';

export interface SaleDraft {
  clientRef: string;
  cart: CartLine[];
  customer: PickedCustomer | null;
  method: string;
  tendered: string;
  exempt: TaxExemption;
}

const KEY = 'dp-pos-sale';
export const newDraft = (): SaleDraft => ({ clientRef: newRef(), cart: [], customer: null, method: '', tendered: '', exempt: { on: false, reason: '' } });

function load(): SaleDraft {
  try {
    const raw = sessionStorage.getItem(KEY);
    const d = raw ? JSON.parse(raw) as SaleDraft : null;
    if (d && typeof d.clientRef === 'string' && Array.isArray(d.cart)) return { ...newDraft(), ...d };
  } catch { /* storage blocked or bad JSON — start fresh */ }
  return newDraft();
}

export function useSaleDraft() {
  const [draft, setDraft] = useState<SaleDraft>(load);
  useEffect(() => {
    try { sessionStorage.setItem(KEY, JSON.stringify(draft)); } catch { /* per-tab convenience only */ }
  }, [draft]);
  return [draft, setDraft] as const;
}
