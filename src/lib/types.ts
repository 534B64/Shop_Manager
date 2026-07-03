// API response shapes shared across pages.
export interface Material {
  id: number; name: string; unit: string; costPerUnitCents: number; laborFactorPct: number; active: boolean;
  priceMode: string; rateCents: number; rate2Cents: number | null; minQty: number; colorMultiplier: boolean;
  usesRoll: boolean; isAddon: boolean;
}
export interface Customer {
  id: number; name: string; phone: string | null; email: string | null; notes: string | null;
  lastJobAt?: string | null;
  level: number;
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
  // Roll-SKU fields (Phase 8) — set only when this item is a vinyl roll tracked
  // by material + color + nominal width. Null on ordinary stock items.
  materialId?: number | null; color?: string | null; nominalWidthIn?: number | null;
  // Inventory taxonomy (Phase 10, Slice 2) — ORTHOGONAL to the roll-SKU fields
  // above. A smart category layer that sits on every item, roll SKUs included.
  categoryId?: number | null; sizeText?: string | null; custom?: string | null; orderNote?: string | null;
}
export interface MaterialColor { id: number; materialId: number; name: string; }
export interface Category {
  id: number; name: string; defaultUnit: string | null; tracksColor: boolean;
  defaultVendor: string | null; active: boolean; sort: number;
}
export interface CategorySize { id: number; categoryId: number; label: string; sort: number; }
// Advisory stock-check result for the estimator (Phase 8).
export interface StockResult {
  state: 'unknown' | 'in_stock' | 'suboptimal' | 'out_of_stock';
  optimalWidth: number | null; useWidth: number | null; fittingInStock: number[];
  message: string | null;
}
