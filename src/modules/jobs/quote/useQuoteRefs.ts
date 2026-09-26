// Reference data the quote form prices against: materials, tax rate, level discounts.
import { useQuery } from '../../../lib/query';
import type { Material } from '../../../lib/types';
import { DEFAULT_TAX_RATE_PCT } from '../../../../shared/domain';

const DEFAULT_LEVELS: Record<string, number> = { 1: 5, 2: 10, 3: 15 };

export function useQuoteRefs() {
  // Archived/inactive included so a saved job still shows the material it was
  // quoted with; the pickers list only live ones plus whatever the form uses.
  const materials = useQuery<Material[]>('/api/materials?all=1&includeArchived=1');
  const tax = useQuery<{ ratePct: number }>('/api/settings/tax');
  const levels = useQuery<Record<string, number>>('/api/settings/levels');
  return {
    materials: materials.data ?? [],
    taxRate: tax.data?.ratePct ?? DEFAULT_TAX_RATE_PCT,
    levels: levels.data ?? DEFAULT_LEVELS,
    loading: materials.loading || tax.loading,
    error: materials.error,
    reload: materials.reload,
  };
}
