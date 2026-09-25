import { useEffect, useMemo, useState } from 'react';
import { get, post, put } from '../../lib/api';
import { ROLL_SIZES, VARIANCE_REASON_CODES, ADJUST_REASON_LABELS, type VarianceReasonCode } from '../../../shared/domain';
import { buildInventoryView } from '../../../shared/inventoryView';
import type { GroupBy, InvViewItem, SearchOp, SortBy } from '../../../shared/inventoryView';
import { reviewCounts, type VarianceThresholds } from '../../../shared/countReview';
import { suggestedMin } from '../../../shared/reorder';
import type { Category, CategorySize, InventoryItem, Material, MaterialColor, Supplier } from '../../lib/types';

interface CycleCount { id: number; scheduledFor: string; completedAt: string | null; }
interface Adjustment { id: number; delta: number; reason: string; note: string | null; createdBy: string | null; createdAt: string; }
interface VarianceRow { createdAt: string; systemCount: number; counted: number; delta: number; pct: number | null; impactCents: number | null; aboveThreshold: boolean; reasonCode: string | null; note: string | null; }
interface CostRow { createdAt: string; delta: number; unitCostCents: number | null; supplierName: string | null; }
interface ReorderRow {
  id: number; name: string; count: number; threshold: number; reorderMaxQty: number | null;
  suggestedQty: number; supplierName: string | null; leadTimeDays: number | null;
  lastCostCents: number | null; purchaseUnit: string | null; countUnit: string | null;
  avgDailyUse: number | null; daysUntilStockout: number | null;
}
interface UsageRow { id: number; name: string; count: number; countUnit: string | null; avgDailyUse: number | null; daysUntilStockout: number | null; }
interface Valuation { totalCents: number; pricedItems: number; unpricedItems: number; byCategory: { name: string; valueCents: number; items: number }[]; }
interface InvSettings extends VarianceThresholds { reorderBufferDays: number; }

const input = 'px-3 py-2.5 bg-bg border border-line rounded-token text-base';
const $ = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const factorOf = (i: InventoryItem) => (i.purchaseToCountFactor && i.purchaseToCountFactor > 0 ? i.purchaseToCountFactor : 1);
const costPerCountUnit = (i: InventoryItem) => (i.lastCostCents == null ? null : Math.round(i.lastCostCents / factorOf(i)));

export default function Inventory() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [cc, setCc] = useState<CycleCount | null>(null);
  // Blind count v2: 'entry' hides system counts (anchoring bias), 'review'
  // reveals the comparison and collects reason codes for flagged variances.
  const [countPhase, setCountPhase] = useState<'off' | 'entry' | 'review'>('off');
  const [counted, setCounted] = useState<Record<number, string>>({});
  const [reasonSel, setReasonSel] = useState<Record<number, string>>({});
  const [noteSel, setNoteSel] = useState<Record<number, string>>({});
  const [nextDate, setNextDate] = useState('');
  const [name, setName] = useState('');
  const [count, setCount] = useState('');
  const [threshold, setThreshold] = useState('');
  // Phase 10, Slice 2: category-aware item entry. ORTHOGONAL to the roll-SKU
  // path — picking a category only pre-fills unit/supplier and reveals
  // category-driven fields (color, size); it never touches material/roll state.
  // Pickers list only live (active, non-archived) categories/suppliers; the
  // all* lists also hold archived ones so existing items keep showing their
  // names (ADR 0005).
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [allSuppliers, setAllSuppliers] = useState<Supplier[]>([]);
  const [invSettings, setInvSettings] = useState<InvSettings>({ pctThreshold: 5, unitThreshold: 5, reorderBufferDays: 3 });
  const [valuation, setValuation] = useState<Valuation | null>(null);
  const [unitTypes, setUnitTypes] = useState<string[]>([]);
  const [itemCategoryId, setItemCategoryId] = useState('');
  const [itemUnit, setItemUnit] = useState('');
  const [itemSupplierId, setItemSupplierId] = useState('');
  const [itemColor, setItemColor] = useState('');
  const [itemSizes, setItemSizes] = useState<CategorySize[]>([]);
  const [itemSize, setItemSize] = useState('');
  const [itemSizeCustom, setItemSizeCustom] = useState('');
  const [itemOrderNote, setItemOrderNote] = useState('');
  const [showReorder, setShowReorder] = useState(false);
  const [reorder, setReorder] = useState<ReorderRow[]>([]);
  const [usage, setUsage] = useState<UsageRow[] | null>(null);
  const [error, setError] = useState('');
  // Roll materials still drive the material filter + the roll grouping of
  // existing SKUs (created via seed/import).
  const [rollMats, setRollMats] = useState<Material[]>([]);
  // Filters — speed up stock checks / cycle counts by narrowing the list.
  const [fSearch, setFSearch] = useState('');
  const [fOp, setFOp] = useState<SearchOp>('contains');
  const [fKind, setFKind] = useState<'all' | 'roll' | 'other'>('all');
  const [fMaterial, setFMaterial] = useState('');
  const [fColor, setFColor] = useState('');
  const [fWidth, setFWidth] = useState('');
  const [fLowOnly, setFLowOnly] = useState(false);
  const [fCategory, setFCategory] = useState('');
  // Organization — group/sort the (filtered) list for browsing a long shelf.
  const [groupBy, setGroupBy] = useState<GroupBy>('material');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // Color list per roll material (from the Materials page) — drives the filter
  // dropdowns so they always show and update when materials/colors are added.
  const [colorsByMat, setColorsByMat] = useState<Record<number, string[]>>({});
  // Receiving form (replaces the old prompt()s): item + qty in PURCHASE units
  // (converted to count units on submit) + cost per purchase unit + supplier.
  const [recv, setRecv] = useState<{ itemId: string; qty: string; cost: string; supplierId: string } | null>(null);
  // Per-item editor: supplier / UOM / Min (with AUTO) / Max.
  const [edit, setEdit] = useState<{ id: number; supplierId: string; purchaseUnit: string; countUnit: string; factor: string; min: string; max: string } | null>(null);

  const refresh = () => {
    get<InventoryItem[]>('/api/inventory').then(setItems).catch(() => {});
    get<CycleCount | null>('/api/cycle-counts/next').then(setCc).catch(() => {});
    get<Material[]>('/api/materials?all=1').then(async (m) => {
      const rolls = m.filter((x) => x.usesRoll && x.active);
      setRollMats(rolls);
      const entries = await Promise.all(
        rolls.map(async (mm) => [mm.id, (await get<MaterialColor[]>(`/api/materials/${mm.id}/colors`)).map((c) => c.name)] as const),
      );
      setColorsByMat(Object.fromEntries(entries));
    }).catch(() => {});
    get<Category[]>('/api/categories?all=1&includeArchived=1').then((all) => {
      setAllCategories(all);
      setCategories(all.filter((c) => c.active && !c.archivedAt));
    }).catch(() => {});
    get<Supplier[]>('/api/suppliers?all=1&includeArchived=1').then((all) => {
      setAllSuppliers(all);
      setSuppliers(all.filter((s) => s.active && !s.archivedAt));
    }).catch(() => {});
    get<InvSettings>('/api/settings/inventory').then(setInvSettings).catch(() => {});
    get<Valuation>('/api/inventory/valuation').then(setValuation).catch(() => {});
    get<{ units: string[] }>('/api/settings/units').then((u) => setUnitTypes(u.units)).catch(() => {});
  };
  useEffect(() => { refresh(); }, []);

  // When the New item category changes, pre-fill unit (editable) and supplier
  // (only if blank), load that category's size list, and reset the
  // per-category fields so a stale color/size doesn't carry over.
  useEffect(() => {
    setItemSize(''); setItemSizeCustom(''); setItemColor('');
    if (!itemCategoryId) { setItemSizes([]); return; }
    const cat = categories.find((c) => c.id === Number(itemCategoryId));
    if (cat?.defaultUnit) setItemUnit(cat.defaultUnit);
    if (cat?.defaultSupplierId && !itemSupplierId) setItemSupplierId(String(cat.defaultSupplierId));
    get<CategorySize[]>(`/api/categories/${itemCategoryId}/sizes`).then(setItemSizes).catch(() => {});
  }, [itemCategoryId]);

  async function add() {
    if (!name.trim()) return setError('Item name required.');
    setError('');
    const sizeText = itemSize === '__custom__' ? itemSizeCustom.trim() : itemSize;
    await post('/api/inventory', {
      name: name.trim(),
      count: Math.max(0, Number(count) || 0),
      lowStockThreshold: Math.max(0, Number(threshold) || 0),
      ...(itemSupplierId ? { supplierId: Number(itemSupplierId) } : {}),
      ...(itemCategoryId ? { categoryId: Number(itemCategoryId) } : {}),
      // itemUnit drives the dropdown pre-fill AND is saved as the count unit
      // (how the weekly count tallies it). Purchase unit defaults to match —
      // 1:1 until the item editor says otherwise.
      ...(itemUnit ? { countUnit: itemUnit, purchaseUnit: itemUnit } : {}),
      ...(sizeText.trim() ? { sizeText: sizeText.trim() } : {}),
      ...(itemColor.trim() ? { color: itemColor.trim() } : {}),
      ...(itemOrderNote.trim() ? { orderNote: itemOrderNote.trim() } : {}),
    });
    setName(''); setCount(''); setThreshold(''); setItemSupplierId('');
    setItemCategoryId(''); setItemUnit(''); setItemColor(''); setItemSize(''); setItemSizeCustom(''); setItemOrderNote('');
    refresh();
  }

  const [history, setHistory] = useState<{ itemId: number; rows: Adjustment[]; variances: VarianceRow[]; repeated: boolean; costs: CostRow[] } | null>(null);

  async function adjust(item: InventoryItem, delta: number, reason: string, note?: string) {
    setError('');
    try {
      await post(`/api/inventory/${item.id}/adjust`, {
        delta, reason, ...(note ? { note } : {}),
      });
      refresh();
      if (history?.itemId === item.id) showHistory(item);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  async function logDiscrepancy(item: InventoryItem) {
    const v = prompt(`Discrepancy for "${item.name}" — counted minus system (e.g. -2 means 2 missing):`);
    if (!v) return;
    const delta = Number(v);
    if (!Number.isInteger(delta) || delta === 0) return setError('Enter a non-zero whole number.');
    const note = prompt('What happened? (required)');
    if (!note?.trim()) return setError('A discrepancy needs an explanation.');
    adjust(item, delta, 'correction', note.trim());
  }

  async function showHistory(item: InventoryItem) {
    const [rows, vari, costs] = await Promise.all([
      get<Adjustment[]>(`/api/inventory/${item.id}/history`),
      get<{ rows: VarianceRow[]; repeated: boolean }>(`/api/inventory/${item.id}/variances`).catch(() => ({ rows: [], repeated: false })),
      get<CostRow[]>(`/api/inventory/${item.id}/cost-history`).catch(() => [] as CostRow[]),
    ]);
    setHistory({ itemId: item.id, rows, variances: vari.rows, repeated: vari.repeated, costs });
  }

  async function scheduleCC() {
    const d = prompt('Schedule cycle count for (YYYY-MM-DD):', new Date().toISOString().slice(0, 10));
    if (!d) return;
    await post('/api/cycle-counts', { scheduledFor: d });
    refresh();
  }

  function startCounting() {
    // BLIND entry — inputs start EMPTY and the system count is hidden, so the
    // person writes down what they see, not what the app expects.
    setCounted({});
    setReasonSel({});
    setNoteSel({});
    const next = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    setNextDate(next);
    setCountPhase('entry');
  }

  // The count worklist: active items grouped by category (admin sort order),
  // uncategorized last — one pass around the shop.
  const worklist = useMemo(() => {
    const sorted = [...categories].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
    const groups: { key: string; label: string; items: InventoryItem[] }[] = sorted
      .map((c) => ({ key: `c${c.id}`, label: c.name, items: items.filter((i) => i.categoryId === c.id) }))
      .filter((g) => g.items.length > 0);
    const other = items.filter((i) => i.categoryId == null || !sorted.some((c) => c.id === i.categoryId));
    if (other.length > 0) groups.push({ key: 'other', label: 'Other / Consumables', items: other });
    for (const g of groups) g.items.sort((a, b) => a.name.localeCompare(b.name));
    return groups;
  }, [items, categories]);

  const enteredIds = useMemo(
    () => items.filter((i) => (counted[i.id] ?? '').trim() !== '' && !Number.isNaN(Number(counted[i.id]))).map((i) => i.id),
    [items, counted]);

  // Review data — shared math with the server, sorted by dollar impact.
  const review = useMemo(() => {
    if (countPhase !== 'review') return [];
    const byId = new Map(items.map((i) => [i.id, i]));
    return reviewCounts(
      enteredIds.map((id) => {
        const i = byId.get(id)!;
        return { itemId: id, systemCount: i.count, counted: Math.max(0, Math.round(Number(counted[id]))), unitCostCents: costPerCountUnit(i) };
      }),
      invSettings,
    );
  }, [countPhase, enteredIds, counted, items, invSettings]);

  const flaggedMissingReason = review.filter((v) => v.aboveThreshold && !reasonSel[v.itemId]);
  const skippedCount = items.length - enteredIds.length;

  async function submitCount() {
    if (!cc) return;
    setError('');
    try {
      const counts = review.map((v) => ({
        itemId: v.itemId, counted: v.counted,
        ...(reasonSel[v.itemId] ? { reasonCode: reasonSel[v.itemId] } : {}),
        ...(noteSel[v.itemId]?.trim() ? { note: noteSel[v.itemId].trim() } : {}),
      }));
      const r = await post<{ itemsAdjusted: number; nextScheduledFor: string }>(`/api/cycle-counts/${cc.id}/complete`, {
        counts,
        ...(nextDate ? { nextScheduledFor: nextDate } : {}),
      });
      setCountPhase('off');
      alert(`Cycle count done — ${r.itemsAdjusted} item(s) adjusted. Next count scheduled for ${r.nextScheduledFor}.`);
      refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Submit failed'); }
  }

  // ---- Receiving ----
  function openReceive(item?: InventoryItem) {
    setRecv({
      itemId: item ? String(item.id) : '',
      qty: '', cost: '',
      supplierId: item?.supplierId != null ? String(item.supplierId) : '',
    });
  }
  const recvItem = recv?.itemId ? items.find((i) => i.id === Number(recv.itemId)) ?? null : null;
  async function submitReceive() {
    if (!recv || !recvItem) return;
    const qty = Number(recv.qty);
    if (!Number.isFinite(qty) || qty <= 0) return setError('Enter a quantity received.');
    const f = factorOf(recvItem);
    const delta = Math.round(qty * f);
    if (delta <= 0) return setError('That quantity converts to zero count units.');
    const cents = recv.cost.trim() ? Math.round(Number(recv.cost) * 100) : null;
    setError('');
    try {
      await post(`/api/inventory/${recvItem.id}/adjust`, {
        delta, reason: 'received',
        ...(cents != null && cents > 0 ? { unitCostCents: cents } : {}),
        ...(recv.supplierId ? { supplierId: Number(recv.supplierId) } : {}),
      });
      setRecv(null);
      refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Receive failed'); }
  }

  // ---- Per-item editor (supplier / UOM / Min–Max) ----
  function openEdit(i: InventoryItem) {
    setEdit({
      id: i.id,
      supplierId: i.supplierId != null ? String(i.supplierId) : '',
      purchaseUnit: i.purchaseUnit ?? '',
      countUnit: i.countUnit ?? '',
      factor: String(factorOf(i)),
      min: String(i.lowStockThreshold),
      max: i.reorderMaxQty != null ? String(i.reorderMaxQty) : '',
    });
  }
  const editItem = edit ? items.find((i) => i.id === edit.id) ?? null : null;
  const editSupplier = edit?.supplierId ? allSuppliers.find((s) => s.id === Number(edit.supplierId)) ?? null : null;
  const autoMin = editItem && editSupplier
    ? suggestedMin(editItem.avgDailyUse, editSupplier.leadTimeDays, invSettings.reorderBufferDays)
    : null;
  async function submitEdit() {
    if (!edit) return;
    const factor = Number(edit.factor);
    setError('');
    try {
      await put(`/api/inventory/${edit.id}`, {
        supplierId: edit.supplierId ? Number(edit.supplierId) : null,
        purchaseUnit: edit.purchaseUnit.trim() || null,
        countUnit: edit.countUnit.trim() || null,
        purchaseToCountFactor: Number.isFinite(factor) && factor > 0 ? factor : 1,
        lowStockThreshold: Math.max(0, Number(edit.min) || 0),
        reorderMaxQty: edit.max.trim() ? Math.max(0, Number(edit.max) || 0) : null,
      });
      setEdit(null);
      refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
  }

  const today = new Date().toISOString().slice(0, 10);
  const ccDue = cc && cc.scheduledFor <= today;

  // Filter options come from the Materials data (not from what's stocked), so a
  // newly added material / color / size shows up immediately.
  const matOptions = useMemo(
    () => [...rollMats].sort((a, b) => a.name.localeCompare(b.name)),
    [rollMats]);
  const colorOptions = useMemo(() => {
    const src = fMaterial ? (colorsByMat[Number(fMaterial)] ?? []) : Object.values(colorsByMat).flat();
    return [...new Set(src)].sort((a, b) => a.localeCompare(b));
  }, [colorsByMat, fMaterial]);
  const widthOptions = ROLL_SIZES;

  // If the chosen color isn't valid for the chosen material, drop it.
  useEffect(() => {
    if (fColor && !colorOptions.includes(fColor)) setFColor('');
  }, [colorOptions, fColor]);

  const filtersActive = !!(fSearch.trim() || fKind !== 'all' || fMaterial || fColor || fWidth || fLowOnly || fCategory);
  const clearFilters = () => { setFSearch(''); setFKind('all'); setFMaterial(''); setFColor(''); setFWidth(''); setFLowOnly(false); setFCategory(''); };

  // Resolve each item's materialName/unit from rollMats for grouping/display.
  // Edge case: if a SKU's material was deactivated (removed from rollMats), the
  // lookup misses and materialName comes back null — the item still has a
  // materialId (so it's a "roll" for fKind), but it lands in the "Other /
  // Consumables" group under groupBy=material, which is an acceptable fallback.
  const invItems: InvViewItem[] = useMemo(() => items.map((i) => {
    const mat = i.materialId != null ? rollMats.find((m) => m.id === i.materialId) : undefined;
    const cat = i.categoryId != null ? allCategories.find((c) => c.id === i.categoryId) : undefined;
    return {
      id: i.id, name: i.name, count: i.count, lowStockThreshold: i.lowStockThreshold,
      vendor: i.vendor, color: i.color ?? null, nominalWidthIn: i.nominalWidthIn ?? null,
      materialId: i.materialId ?? null, materialName: mat?.name ?? null, unit: mat?.unit ?? null,
      categoryId: i.categoryId ?? null, categoryName: cat?.name ?? null,
    };
  }), [items, rollMats, allCategories]);

  const view = useMemo(() => buildInventoryView(invItems, {
    search: fSearch, op: fOp, kind: fKind,
    materialId: fMaterial ? Number(fMaterial) : null,
    color: fColor || null,
    widthIn: fWidth ? Number(fWidth) : null,
    lowOnly: fLowOnly, groupBy, sortBy,
    categoryId: fCategory ? Number(fCategory) : null,
  }), [invItems, fSearch, fOp, fKind, fMaterial, fColor, fWidth, fLowOnly, groupBy, sortBy, fCategory]);

  const toggleGroup = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));
  const supplierName = (id: number | null | undefined, fallback?: string | null) =>
    id != null ? allSuppliers.find((s) => s.id === id)?.name ?? fallback ?? null : fallback ?? null;

  const select = 'px-3 py-2 bg-bg border border-line rounded-token text-sm';
  const reasonLabel = (code: string) => ADJUST_REASON_LABELS[code as VarianceReasonCode] ?? code;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">Inventory</h1>
        <div className="flex gap-2">
          {cc && countPhase === 'off' && (
            <button onClick={startCounting}
              className={`px-4 py-2 rounded-token font-semibold ${ccDue ? 'bg-warn text-white' : 'border border-line hover:bg-bg'}`}>
              {ccDue ? 'Cycle count due — start' : `Cycle count ${cc.scheduledFor} — start early`}
            </button>
          )}
          {!cc && <button onClick={scheduleCC} className="px-4 py-2 border border-line rounded-token hover:bg-bg">Schedule cycle count</button>}
          <button onClick={() => openReceive()} className="px-4 py-2 border border-line rounded-token hover:bg-bg">Receive stock</button>
          <button onClick={async () => {
            const r = await get<ReorderRow[]>('/api/inventory/reorder');
            setReorder(r); setShowReorder(true); setUsage(null);
          }} className="px-4 py-2 border border-line rounded-token hover:bg-bg">Needs ordering</button>
          <button onClick={async () => {
            const t = await get<UsageRow[]>('/api/inventory/usage');
            setUsage(t); setShowReorder(false);
          }} className="px-4 py-2 border border-line rounded-token hover:bg-bg">Usage</button>
        </div>
      </div>
      <p className="text-muted mb-6">
        Simple unit counts. Every change is logged with a reason.
        {valuation && valuation.pricedItems > 0 && (
          <span> · On-hand value <b className="text-ink">{$(valuation.totalCents)}</b> across {valuation.pricedItems} priced item(s){valuation.unpricedItems > 0 ? ` (${valuation.unpricedItems} without a cost)` : ''}</span>
        )}
      </p>
      {error && <p className="text-danger mb-3">{error}</p>}

      {/* ---- Blind count: entry phase (system counts hidden on purpose) ---- */}
      {countPhase === 'entry' && cc && (
        <div className="bg-surface border-2 border-accent rounded-token p-5 mb-6">
          <h2 className="font-semibold text-lg mb-1">Cycle count — write down what you actually see</h2>
          <p className="text-sm text-muted mb-3">System counts are hidden until review so the shelf, not the app, decides. Leave an item blank to skip it this week.</p>
          <div className="space-y-4 mb-4">
            {worklist.map((g) => (
              <div key={g.key}>
                <h3 className="font-semibold text-sm text-muted uppercase tracking-wide mb-1.5">{g.label}</h3>
                <div className="space-y-2">
                  {g.items.map((i) => (
                    <div key={i.id} className="flex items-center gap-3">
                      <span className="flex-1">{i.name}{i.countUnit ? <span className="text-muted text-sm"> ({i.countUnit})</span> : null}</span>
                      <input className={`${input} w-24`} inputMode="numeric" value={counted[i.id] ?? ''}
                        onChange={(e) => setCounted({ ...counted, [i.id]: e.target.value })} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-3 items-center">
            <span className="text-sm text-muted">{enteredIds.length} of {items.length} entered</span>
            <button onClick={() => setCountPhase('review')} disabled={enteredIds.length === 0}
              className="px-5 py-2.5 bg-accent text-accent-contrast rounded-token font-semibold disabled:opacity-50">
              Review variances →
            </button>
            <button onClick={() => setCountPhase('off')} className="px-5 py-2.5 border border-line rounded-token">Cancel</button>
          </div>
        </div>
      )}

      {/* ---- Blind count: review phase (variances by dollar impact) ---- */}
      {countPhase === 'review' && cc && (
        <div className="bg-surface border-2 border-accent rounded-token p-5 mb-6">
          <h2 className="font-semibold text-lg mb-1">Review — biggest discrepancies first</h2>
          <p className="text-sm text-muted mb-3">
            Variances beyond ±{invSettings.pctThreshold}% or ±{invSettings.unitThreshold} units need a reason before submitting
            (adjustable in Settings). {skippedCount > 0 ? `${skippedCount} item(s) left blank — their counts stay as-is.` : ''}
          </p>
          <div className="space-y-2 mb-4">
            {review.map((v) => {
              const i = items.find((x) => x.id === v.itemId);
              if (!i) return null;
              const needsReason = v.aboveThreshold;
              return (
                <div key={v.itemId} className={`border rounded-token p-2.5 ${needsReason ? 'border-warn' : 'border-line'}`}>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-semibold flex-1">{i.name}</span>
                    <span className="text-sm text-muted">system {v.systemCount} → counted {v.counted}</span>
                    <span className={`font-bold ${v.delta === 0 ? 'text-ok' : 'text-warn'}`}>
                      {v.delta > 0 ? '+' : ''}{v.delta}{v.pct != null && v.delta !== 0 ? ` (${v.pct > 0 ? '+' : ''}${v.pct.toFixed(0)}%)` : ''}
                    </span>
                    {v.impactCents != null && v.delta !== 0 && <span className="text-sm font-semibold">{$(v.impactCents)}</span>}
                    {needsReason && (
                      <select className={select} value={reasonSel[v.itemId] ?? ''}
                        onChange={(e) => setReasonSel({ ...reasonSel, [v.itemId]: e.target.value })}>
                        <option value="">Reason required…</option>
                        {VARIANCE_REASON_CODES.map((c) => <option key={c} value={c}>{reasonLabel(c)}</option>)}
                      </select>
                    )}
                  </div>
                  {v.delta !== 0 && (
                    <input className={`${input} w-full mt-2 text-sm py-1.5`} placeholder="Notes (optional)"
                      value={noteSel[v.itemId] ?? ''} onChange={(e) => setNoteSel({ ...noteSel, [v.itemId]: e.target.value })} />
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <label className="block text-sm text-muted mb-1">Schedule next count</label>
              <input type="date" className={input} value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
            </div>
            <button onClick={submitCount} disabled={flaggedMissingReason.length > 0}
              className="px-5 py-2.5 bg-accent text-accent-contrast rounded-token font-semibold disabled:opacity-50">
              Submit & lock count
            </button>
            <button onClick={() => setCountPhase('entry')} className="px-5 py-2.5 border border-line rounded-token">← Back to entry</button>
            {flaggedMissingReason.length > 0 && (
              <span className="text-sm text-warn">Pick a reason for {flaggedMissingReason.length} flagged variance(s) to submit.</span>
            )}
          </div>
        </div>
      )}

      {/* ---- Receiving form ---- */}
      {recv && (
        <div className="bg-surface border-2 border-accent rounded-token p-5 mb-6">
          <h2 className="font-semibold text-lg mb-3">Receive stock</h2>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="min-w-64">
              <label className="block text-sm text-muted mb-1">Item</label>
              <select className={input} value={recv.itemId}
                onChange={(e) => {
                  const it = items.find((i) => i.id === Number(e.target.value));
                  setRecv({ ...recv, itemId: e.target.value, supplierId: it?.supplierId != null ? String(it.supplierId) : recv.supplierId });
                }}>
                <option value="">Pick an item…</option>
                {[...items].sort((a, b) => a.name.localeCompare(b.name)).map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Qty received{recvItem?.purchaseUnit ? ` (${recvItem.purchaseUnit})` : ''}</label>
              <input className={`${input} w-28`} inputMode="decimal" value={recv.qty}
                onChange={(e) => setRecv({ ...recv, qty: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Cost paid ($ per {recvItem?.purchaseUnit || 'unit'})</label>
              <input className={`${input} w-28`} inputMode="decimal" value={recv.cost}
                onChange={(e) => setRecv({ ...recv, cost: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Supplier</label>
              <select className={input} value={recv.supplierId} onChange={(e) => setRecv({ ...recv, supplierId: e.target.value })}>
                <option value="">—</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <button onClick={submitReceive} className="px-5 py-2.5 bg-accent text-accent-contrast rounded-token font-semibold">Receive</button>
            <button onClick={() => setRecv(null)} className="px-5 py-2.5 border border-line rounded-token">Cancel</button>
          </div>
          {recvItem && factorOf(recvItem) !== 1 && Number(recv.qty) > 0 && (
            <p className="text-sm text-muted mt-2">
              {recv.qty} {recvItem.purchaseUnit || 'purchase unit(s)'} × {factorOf(recvItem)} = <b className="text-ink">+{Math.round(Number(recv.qty) * factorOf(recvItem))} {recvItem.countUnit || 'count units'}</b>
            </p>
          )}
        </div>
      )}

      <div className="bg-surface border border-line rounded-token p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-48">
          <label className="block text-sm text-muted mb-1">New item</label>
          <input className={`${input} w-full`} value={name} onChange={(e) => setName(e.target.value)} placeholder='Vinyl roll 24" white' />
        </div>
        <div>
          <label className="block text-sm text-muted mb-1">Category</label>
          <select className={input} value={itemCategoryId} onChange={(e) => setItemCategoryId(e.target.value)}>
            <option value="">—</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm text-muted mb-1">Unit</label>
          <select className={input} value={itemUnit} onChange={(e) => setItemUnit(e.target.value)}>
            <option value="">—</option>
            {unitTypes.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        {(() => {
          const cat = categories.find((c) => c.id === Number(itemCategoryId));
          return cat?.tracksColor ? (
            <div>
              <label className="block text-sm text-muted mb-1">Color</label>
              <input className={`${input} w-28`} value={itemColor} onChange={(e) => setItemColor(e.target.value)} placeholder="Red" />
            </div>
          ) : null;
        })()}
        <div>
          <label className="block text-sm text-muted mb-1">Size</label>
          {itemSizes.length > 0 ? (
            <select className={input} value={itemSize} onChange={(e) => setItemSize(e.target.value)}>
              <option value="">—</option>
              {itemSizes.map((s) => <option key={s.id} value={s.label}>{s.label}</option>)}
              <option value="__custom__">Custom…</option>
            </select>
          ) : (
            <input className={`${input} w-28`} value={itemSizeCustom} onChange={(e) => setItemSizeCustom(e.target.value)} placeholder="24in" />
          )}
        </div>
        {itemSizes.length > 0 && itemSize === '__custom__' && (
          <div>
            <label className="block text-sm text-muted mb-1">Custom size</label>
            <input className={`${input} w-28`} value={itemSizeCustom} onChange={(e) => setItemSizeCustom(e.target.value)} placeholder="Other" />
          </div>
        )}
        <div>
          <label className="block text-sm text-muted mb-1">On hand</label>
          <input className={`${input} w-24`} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm text-muted mb-1">Low-stock at</label>
          <input className={`${input} w-24`} inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm text-muted mb-1">Supplier</label>
          <select className={`${input} w-36`} value={itemSupplierId} onChange={(e) => setItemSupplierId(e.target.value)}>
            <option value="">—</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-40">
          <label className="block text-sm text-muted mb-1">Order note</label>
          <input className={`${input} w-full`} value={itemOrderNote} onChange={(e) => setItemOrderNote(e.target.value)} placeholder="Optional" />
        </div>
        <button onClick={add} className="px-5 py-2.5 bg-accent text-accent-contrast rounded-token font-semibold">Add</button>
      </div>

      {/* Filters — search + narrow by kind, material, color, width, low-stock. */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input className={`${select} flex-1 min-w-48`} value={fSearch} onChange={(e) => setFSearch(e.target.value)}
          placeholder="Search name, color, vendor…" />
        <select className={select} value={fOp} onChange={(e) => setFOp(e.target.value as SearchOp)}>
          <option value="contains">contains</option>
          <option value="starts_with">starts with</option>
          <option value="ends_with">ends with</option>
          <option value="equals">equals</option>
        </select>
        <select className={select} value={fKind} onChange={(e) => setFKind(e.target.value as 'all' | 'roll' | 'other')}>
          <option value="all">All items</option>
          <option value="roll">Vinyl rolls</option>
          <option value="other">Other stock</option>
        </select>
        {matOptions.length > 0 && (
          <select className={select} value={fMaterial} onChange={(e) => setFMaterial(e.target.value)}>
            <option value="">Any material</option>
            {matOptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
        {colorOptions.length > 0 && (
          <select className={select} value={fColor} onChange={(e) => setFColor(e.target.value)}>
            <option value="">Any color</option>
            {colorOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {widthOptions.length > 0 && (
          <select className={select} value={fWidth} onChange={(e) => setFWidth(e.target.value)}>
            <option value="">Any size</option>
            {widthOptions.map((w) => <option key={w} value={w}>{w}″</option>)}
          </select>
        )}
        {categories.length > 0 && (
          <select className={select} value={fCategory} onChange={(e) => setFCategory(e.target.value)}>
            <option value="">Any category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <label className="flex items-center gap-1.5 text-sm text-muted">
          <input type="checkbox" checked={fLowOnly} onChange={(e) => setFLowOnly(e.target.checked)} />
          Low only
        </label>
        {filtersActive && <button onClick={clearFilters} className="text-sm text-accent underline">Clear</button>}
        <span className="text-sm text-muted ml-auto">{view.totalShown} of {items.length}</span>
      </div>

      {/* Organization — group the (filtered) list, sort within each group. */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <label className="text-sm text-muted">Group by</label>
        <select className={select} value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
          <option value="material">Material</option>
          <option value="color">Color</option>
          <option value="size">Size</option>
          <option value="unit">Unit</option>
          <option value="category">Category</option>
        </select>
        <label className="text-sm text-muted">Sort</label>
        <select className={select} value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
          <option value="name">Name</option>
          <option value="size">Size</option>
          <option value="color">Color</option>
          <option value="count">Count</option>
          <option value="low_first">Low first</option>
        </select>
      </div>

      <div className="bg-surface border border-line rounded-token overflow-hidden">
        {view.groups.map((g, gi) => {
          const isCollapsed = !!collapsed[g.key];
          return (
            <div key={g.key} className={gi > 0 ? 'border-t border-line' : ''}>
              <button onClick={() => toggleGroup(g.key)}
                className="w-full flex items-center gap-2 px-4 py-2.5 bg-bg hover:bg-surface text-left">
                <span className="text-muted text-xs w-3">{isCollapsed ? '▶' : '▼'}</span>
                <span className="font-semibold flex-1">{g.label}</span>
                <span className="text-xs px-2 py-0.5 rounded-token border border-line text-muted">{g.count}</span>
                {g.lowCount > 0 && <span className="text-xs px-2 py-0.5 rounded-token bg-warn text-white">LOW {g.lowCount}</span>}
              </button>
              {!isCollapsed && (
                <div className="divide-y divide-line">
                  {g.items.map((vi) => {
                    const i = items.find((x) => x.id === vi.id);
                    if (!i) return null;
                    const out = i.count === 0;
                    const low = !out && i.count <= i.lowStockThreshold;
                    const catName = i.categoryId != null ? (allCategories.find((c) => c.id === i.categoryId)?.name ?? null) : null;
                    const sizeLabel = i.sizeText || (i.nominalWidthIn != null ? `${i.nominalWidthIn}″` : null);
                    const sup = supplierName(i.supplierId, i.vendor);
                    const isEditing = edit?.id === i.id;
                    return (
                      <div key={i.id}>
                        <div className="flex items-center gap-3 px-4 py-3">
                          {/* Stock status: green in stock / yellow low / red out */}
                          <span title={out ? 'Out of stock' : low ? 'Low (at/below Min)' : 'In stock'}
                            className={`w-2.5 h-2.5 rounded-full shrink-0 ${out ? 'bg-danger' : low ? 'bg-warn' : 'bg-ok'}`} />
                          <div className="flex-1 flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold">{i.name}</span>
                            {catName && <span className="text-xs px-1.5 py-0.5 rounded-token border border-accent text-accent">{catName}</span>}
                            {i.materialId != null && <span className="text-xs px-1.5 py-0.5 rounded-token border border-line text-muted">roll</span>}
                            {i.color && <span className="text-xs px-1.5 py-0.5 rounded-token border border-line text-muted">{i.color}</span>}
                            {sizeLabel && <span className="text-xs px-1.5 py-0.5 rounded-token border border-line text-muted">{sizeLabel}</span>}
                            {out && <span className="text-xs px-2 py-0.5 rounded-token bg-danger text-white">OUT</span>}
                            {low && <span className="text-xs px-2 py-0.5 rounded-token bg-warn text-white">LOW</span>}
                            {i.avgDailyUse != null && i.avgDailyUse > 0 && (
                              <span className="text-xs px-1.5 py-0.5 rounded-token border border-line text-muted" title="Avg daily usage from cycle counts">~{i.avgDailyUse}/day</span>
                            )}
                          </div>
                          <span className={`text-xl font-bold w-16 text-right ${out ? 'text-danger' : low ? 'text-warn' : ''}`}>{i.count}</span>
                          <span className="text-xs text-muted w-28">Min {i.lowStockThreshold}{i.reorderMaxQty != null ? ` · Max ${i.reorderMaxQty}` : ''}{sup ? ` · ${sup}` : ''}{i.lastCostCents != null ? ` · last ${$(i.lastCostCents)}` : ''}</span>
                          <button onClick={() => adjust(i, -1, 'used')} className="w-10 h-10 border border-line rounded-token text-lg hover:bg-bg">−</button>
                          <button onClick={() => adjust(i, 1, 'received')} className="w-10 h-10 border border-line rounded-token text-lg hover:bg-bg">+</button>
                          <button onClick={() => openReceive(i)} className="px-3 h-10 border border-line rounded-token text-sm hover:bg-bg">Receive…</button>
                          <button onClick={() => logDiscrepancy(i)} className="px-3 h-10 border border-warn text-warn rounded-token text-sm hover:bg-bg">Discrepancy</button>
                          <button onClick={() => (isEditing ? setEdit(null) : openEdit(i))} className="px-3 h-10 border border-line rounded-token text-sm hover:bg-bg">Edit</button>
                          <button onClick={() => (history?.itemId === i.id ? setHistory(null) : showHistory(i))}
                            className="px-3 h-10 border border-line rounded-token text-sm hover:bg-bg">Log</button>
                          <button onClick={() => put(`/api/inventory/${i.id}`, { active: false }).then(refresh)}
                            className="px-3 h-10 border border-line rounded-token text-sm text-muted hover:bg-bg">Remove</button>
                        </div>
                        {isEditing && edit && (
                          <div className="px-4 pb-3 flex flex-wrap gap-3 items-end bg-bg/50">
                            <div>
                              <label className="block text-xs text-muted mb-1">Supplier</label>
                              <select className={select} value={edit.supplierId} onChange={(e) => setEdit({ ...edit, supplierId: e.target.value })}>
                                <option value="">—</option>
                                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.leadTimeDays}d lead)</option>)}
                                {editSupplier && !suppliers.some((s) => s.id === editSupplier.id) && (
                                  <option value={editSupplier.id}>{editSupplier.name} (archived/inactive)</option>
                                )}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs text-muted mb-1">Bought as</label>
                              <select className={select} value={edit.purchaseUnit} onChange={(e) => setEdit({ ...edit, purchaseUnit: e.target.value })}>
                                <option value="">—</option>
                                {unitTypes.map((u) => <option key={u} value={u}>{u}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs text-muted mb-1">Counted as</label>
                              <select className={select} value={edit.countUnit} onChange={(e) => setEdit({ ...edit, countUnit: e.target.value })}>
                                <option value="">—</option>
                                {unitTypes.map((u) => <option key={u} value={u}>{u}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs text-muted mb-1" title="Count units per purchase unit">× factor</label>
                              <input className={`${select} w-20`} inputMode="decimal" value={edit.factor}
                                onChange={(e) => setEdit({ ...edit, factor: e.target.value })} />
                            </div>
                            <div>
                              <label className="block text-xs text-muted mb-1">Min (reorder at)</label>
                              <div className="flex gap-1">
                                <input className={`${select} w-20`} inputMode="numeric" value={edit.min}
                                  onChange={(e) => setEdit({ ...edit, min: e.target.value })} />
                                <button
                                  onClick={() => autoMin != null && setEdit({ ...edit, min: String(autoMin) })}
                                  disabled={autoMin == null}
                                  title={autoMin != null
                                    ? `~${editItem?.avgDailyUse}/day × (${editSupplier?.leadTimeDays}d lead + ${invSettings.reorderBufferDays}d buffer) = ${autoMin}`
                                    : 'Needs a usage rate (two cycle counts) and a supplier with a lead time'}
                                  className={`${select} font-semibold disabled:opacity-40`}>
                                  AUTO{autoMin != null ? ` ${autoMin}` : ''}
                                </button>
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs text-muted mb-1">Max (order up to)</label>
                              <input className={`${select} w-20`} inputMode="numeric" value={edit.max} placeholder="—"
                                onChange={(e) => setEdit({ ...edit, max: e.target.value })} />
                            </div>
                            <button onClick={submitEdit} className="px-4 py-2 bg-accent text-accent-contrast rounded-token text-sm font-semibold">Save</button>
                            <button onClick={() => setEdit(null)} className="px-4 py-2 border border-line rounded-token text-sm">Cancel</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {items.length === 0 && <p className="text-muted p-4">No items yet — add vinyl rolls, shirt blanks, magnet stock.</p>}
        {items.length > 0 && view.groups.length === 0 && (
          <p className="text-muted p-4">No items match these filters. <button onClick={clearFilters} className="text-accent underline">Clear</button></p>
        )}
      </div>

      {showReorder && (
        <div className="bg-surface border-2 border-warn rounded-token mt-4 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">Needs ordering — {reorder.length} item(s) at/below Min, most urgent first</h3>
            <div className="flex gap-3">
              <button onClick={() => window.print()} className="text-sm text-accent underline">Print</button>
              <button onClick={() => setShowReorder(false)} className="text-sm text-muted underline">close</button>
            </div>
          </div>
          {reorder.length === 0 && <p className="text-muted">Nothing below Min. 🎉</p>}
          {reorder.map((r) => (
            <div key={r.id} className="flex gap-3 py-1.5 border-b border-line text-sm items-center">
              <span className="flex-1 font-semibold">{r.name}</span>
              {r.daysUntilStockout != null && (
                <span className={`font-semibold ${r.daysUntilStockout <= 3 ? 'text-danger' : 'text-warn'}`}>
                  ~{r.daysUntilStockout.toFixed(0)}d left
                </span>
              )}
              <span className="text-muted">have {r.count} / Min {r.threshold}</span>
              <span className="font-bold text-warn">order {r.suggestedQty}{r.reorderMaxQty != null ? ` → ${r.reorderMaxQty}` : ''}</span>
              <span className="text-muted w-36 truncate">{r.supplierName ?? 'no supplier'}{r.leadTimeDays != null ? ` · ${r.leadTimeDays}d lead` : ''}</span>
              <span className="text-muted">{r.lastCostCents != null ? `last ${$(r.lastCostCents)}` : ''}</span>
            </div>
          ))}
        </div>
      )}

      {usage && (
        <div className="bg-surface border border-line rounded-token mt-4 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">Usage — avg per day from cycle counts</h3>
            <button onClick={() => setUsage(null)} className="text-sm text-muted underline">close</button>
          </div>
          <p className="text-sm text-muted mb-2">Rates come from count-to-count reconciliation (plus receipts), so untracked production use and waste are included. Items need two counts before a rate shows.</p>
          {usage.map((u) => (
            <div key={u.id} className="flex gap-4 py-1.5 border-b border-line text-sm items-center">
              <span className="flex-1 font-semibold">{u.name}</span>
              <span>{u.avgDailyUse != null ? <b>~{u.avgDailyUse}/day</b> : <span className="text-muted italic">no rate yet</span>}</span>
              <span className="text-muted">have {u.count}{u.countUnit ? ` ${u.countUnit}` : ''}</span>
              <span className="text-muted w-24 text-right">{u.daysUntilStockout != null ? `~${u.daysUntilStockout.toFixed(0)}d left` : ''}</span>
            </div>
          ))}
          {usage.length === 0 && <p className="text-muted">No items.</p>}
        </div>
      )}

      {history && (
        <div className="bg-surface border border-line rounded-token mt-4">
          <h3 className="font-semibold px-4 pt-3 pb-1">Change log — {items.find((i) => i.id === history.itemId)?.name}</h3>
          {history.repeated && (
            <p className="mx-4 mb-2 px-3 py-2 rounded-token bg-warn text-white text-sm font-semibold">
              Repeated count variance — 3+ of the last 4 counts were off. Check the unit conversion, how it's being counted, or whether the supplier is shorting orders.
            </p>
          )}
          {history.variances.length > 0 && (
            <div className="px-4 pb-2">
              <h4 className="text-sm font-semibold text-muted mb-1">Count history</h4>
              {history.variances.map((v, idx) => (
                <div key={idx} className="flex gap-3 py-1 text-sm border-b border-line items-center">
                  <span className="text-muted w-24">{new Date(v.createdAt).toLocaleDateString()}</span>
                  <span className="text-muted">system {v.systemCount} → counted {v.counted}</span>
                  <span className={`font-bold ${v.delta === 0 ? 'text-ok' : 'text-warn'}`}>{v.delta > 0 ? '+' : ''}{v.delta}</span>
                  {v.pct != null && v.delta !== 0 && <span className="text-muted">{v.pct > 0 ? '+' : ''}{v.pct.toFixed(0)}%</span>}
                  {v.impactCents != null && v.delta !== 0 && <span>{$(v.impactCents)}</span>}
                  {v.reasonCode && <span className="text-xs px-1.5 py-0.5 rounded-token border border-line text-muted">{reasonLabel(v.reasonCode)}</span>}
                  <span className="flex-1 truncate text-muted">{v.note ?? ''}</span>
                </div>
              ))}
            </div>
          )}
          {history.costs.length > 0 && (
            <div className="px-4 pb-2">
              <h4 className="text-sm font-semibold text-muted mb-1">Cost paid per receipt</h4>
              {history.costs.map((c, idx) => (
                <div key={idx} className="flex gap-3 py-1 text-sm border-b border-line items-center">
                  <span className="text-muted w-24">{new Date(c.createdAt).toLocaleDateString()}</span>
                  <span className="font-semibold">{c.unitCostCents != null ? $(c.unitCostCents) : '—'}</span>
                  <span className="text-muted">× {c.delta}</span>
                  <span className="flex-1 text-muted">{c.supplierName ?? ''}</span>
                </div>
              ))}
            </div>
          )}
          <div className="divide-y divide-line">
            {history.rows.map((a) => (
              <div key={a.id} className="flex gap-3 px-4 py-2 text-sm">
                <span className={`w-12 font-bold ${a.delta < 0 ? 'text-danger' : 'text-ok'}`}>{a.delta > 0 ? '+' : ''}{a.delta}</span>
                <span className="w-40 text-muted">{reasonLabel(a.reason)}</span>
                <span className="flex-1 truncate">{a.note ?? '—'}</span>
                <span className="text-muted">{a.createdBy ?? '—'}</span>
                <span className="text-muted">{new Date(a.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
            {history.rows.length === 0 && <p className="text-muted px-4 py-3">No changes logged yet.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
