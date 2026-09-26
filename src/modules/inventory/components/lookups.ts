// Small reference tables the inventory pages share (a few dozen rows each, so
// fetched whole). Archived categories/suppliers are included so old items keep
// showing their names; pickers use the `live` lists.
import { useMemo } from 'react';
import { useQuery } from '../../../lib/query';
import type { Category, Supplier } from '../../../lib/types';
import type { InvSettings, Location } from '../types';

const isLive = (x: { active?: boolean; archivedAt?: string | null }) => x.active !== false && !x.archivedAt;

export function useCategories() {
  const q = useQuery<Category[]>('/api/categories?all=1&includeArchived=1');
  return useMemo(() => {
    const all = q.data ?? [];
    return { all, live: all.filter(isLive), name: (id: number | null | undefined) => all.find((c) => c.id === id)?.name ?? null };
  }, [q.data]);
}

export function useSuppliers() {
  const q = useQuery<Supplier[]>('/api/suppliers?all=1&includeArchived=1');
  return useMemo(() => {
    const all = q.data ?? [];
    return { all, live: all.filter(isLive), byId: (id: number | null | undefined) => all.find((s) => s.id === id) ?? null };
  }, [q.data]);
}

export function useUnits(): string[] {
  return useQuery<{ units: string[] }>('/api/settings/units').data?.units ?? [];
}

export const DEFAULT_INV_SETTINGS: InvSettings = { pctThreshold: 5, unitThreshold: 5, reorderBufferDays: 3 };
export function useInvSettings(): InvSettings {
  return useQuery<InvSettings>('/api/settings/inventory').data ?? DEFAULT_INV_SETTINGS;
}

export function useLocations(): Location[] {
  return useQuery<Location[]>('/api/locations').data ?? [];
}
