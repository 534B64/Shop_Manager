// Response shapes of the inventory endpoints the pages read (server/modules/inventory).
import type { VarianceThresholds } from '../../../shared/countReview';

export interface InvSettings extends VarianceThresholds { reorderBufferDays: number }
export interface Location { id: number; name: string; archivedAt?: string | null }
export interface Balance { locationId: number; locationName: string; onHand: number }
export interface Valuation {
  totalCents: number; pricedItems: number; unpricedItems: number;
  byCategory: { name: string; valueCents: number; items: number }[];
}

/** One inventory transaction (ledger row). */
export interface Txn {
  id: number; itemId: number; delta: number; txnType: string; reason: string; note: string | null;
  createdBy: string | null; createdAt: string; locationId: number; unitCostCents: number | null;
  purchaseUnitCostCents?: number | null; sourceType?: string; sourceId?: string | null;
  /** Cross-item list only. */
  itemName?: string; locationName?: string | null; countUnit?: string | null;
}

export interface VarianceRow {
  createdAt: string; systemCount: number; counted: number; delta: number; pct: number | null;
  impactCents: number | null; aboveThreshold: boolean; reasonCode: string | null; note: string | null;
}
export interface CostRow { createdAt: string; delta: number; unitCostCents: number | null; supplierName: string | null }

export interface ReorderRow {
  id: number; name: string; count: number; threshold: number; reorderMaxQty: number | null;
  suggestedQty: number; supplierId: number | null; supplierName: string | null; leadTimeDays: number | null;
  lastCostCents: number | null; purchaseUnit: string | null; countUnit: string | null;
  avgDailyUse: number | null; daysUntilStockout: number | null;
}
export interface UsageRow {
  id: number; name: string; count: number; countUnit: string | null;
  avgDailyUse: number | null; daysUntilStockout: number | null;
}

export type CountStatus = 'counting' | 'submitted' | 'posted';
export interface CountLine {
  itemId: number; name: string; countUnit?: string | null; systemCount: number; countedQty: number;
  unitCostCents?: number | null; reasonCode: string | null; note: string | null;
}
export interface CycleCount {
  id: number; scheduledFor: string; completedAt: string | null; completedBy?: string | null;
  status: CountStatus; submittedBy: string | null; submittedAt: string | null; postedBy?: string | null;
  notes: string | null; nextScheduledFor?: string | null; lines?: CountLine[];
}
