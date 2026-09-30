// API response shapes shared across pages.
export interface Material {
  id: number; name: string; unit: string; costPerUnitCents: number; laborFactorPct: number; active: boolean;
  priceMode: string; rateCents: number; rate2Cents: number | null; minQty: number; colorMultiplier: boolean;
  usesRoll: boolean; isAddon: boolean; archivedAt?: string | null;
}
export interface Customer {
  id: number; name: string; phone: string | null; email: string | null; notes: string | null;
  lastJobAt?: string | null;
  level: number;
  archivedAt?: string | null; // archived = hidden from lists/pickers (ADR 0005)
}
export interface Job {
  id: number; clientRef: string | null; customerId: number | null;
  customerName: string | null; customerPhone: string | null;
  po: string | null; tags: string | null; fileRef: string | null; createdBy: string | null;
  rollWidthIn: number | null;
  type: string; title: string; status: string; useProofFlow: boolean;
  dueDate: string | null; quantity: number; widthIn: number | null; heightIn: number | null;
  mainColorMult: number; materialId: number | null; materialName: string | null;
  materialCostSnapshotCents: number | null;
  taxable: boolean; discountPct: number | null; totalCents: number | null;
  suggestedPriceCents: number | null; finalPriceCents: number | null;
  notes: string | null; createdAt: string;
  paidCents?: number;
}
export interface JobItem {
  id: number; jobId: number; type: string; title: string; qty: number; priceCents: number;
  materialId: number | null; widthIn: number | null; heightIn: number | null; fileRef: string | null;
  rollWidthIn: number | null; colorMult: number;
}
export interface Payment {
  id: number; jobId: number; amountCents: number; method: string; note: string | null; createdAt: string;
}
export interface InventoryItem {
  id: number; name: string; count: number; lowStockThreshold: number; active: boolean;
  vendor: string | null; lastCostCents: number | null;
  // false = `name` was generated from color/category/size (shared/itemName.ts).
  nameIsCustom?: boolean;
  // Roll-SKU fields (Phase 8) — set only when this item is a vinyl roll tracked
  // by material + color + nominal width. Null on ordinary stock items.
  materialId?: number | null; color?: string | null; nominalWidthIn?: number | null;
  // Inventory taxonomy (Phase 10, Slice 2) — ORTHOGONAL to the roll-SKU fields
  // above. A smart category layer that sits on every item, roll SKUs included.
  categoryId?: number | null; sizeText?: string | null; custom?: string | null; orderNote?: string | null;
  // Inventory management pass (2026-07-07): preferred supplier, UOM
  // (purchase unit / count unit / count-units-per-purchase-unit), Max
  // (reorder-up-to), and the count-derived rolling usage rate.
  supplierId?: number | null; purchaseUnit?: string | null; countUnit?: string | null;
  purchaseToCountFactor?: number; reorderMaxQty?: number | null; avgDailyUse?: number | null;
  // Moving weighted-average cost per count unit (Phase 2, ADR 0006).
  avgCostCents?: number;
}
export interface Supplier {
  id: number; name: string; leadTimeDays: number; contact: string | null;
  notes: string | null; active: boolean; archivedAt?: string | null;
}
export interface MaterialColor { id: number; materialId: number; name: string; archivedAt?: string | null; }
export interface Category {
  id: number; name: string; defaultUnit: string | null; tracksColor: boolean;
  defaultVendor: string | null; defaultSupplierId: number | null; active: boolean; sort: number;
  archivedAt?: string | null;
}
export interface CategorySize { id: number; categoryId: number; label: string; sort: number; archivedAt?: string | null; }
// Advisory stock-check result for the estimator (Phase 8).
export interface StockResult {
  state: 'unknown' | 'in_stock' | 'suboptimal' | 'out_of_stock';
  optimalWidth: number | null; useWidth: number | null; fittingInStock: number[];
  message: string | null;
}
