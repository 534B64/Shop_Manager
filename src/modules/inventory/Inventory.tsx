import { useEffect, useMemo, useState } from 'react';
import { get, post, put } from '../../lib/api';
import { currentUser } from '../../lib/session';
import { ROLL_SIZES } from '../../../shared/domain';
import { buildInventoryView } from '../../../shared/inventoryView';
import type { GroupBy, InvViewItem, SearchOp, SortBy } from '../../../shared/inventoryView';
import type { Category, CategorySize, InventoryItem, Material, MaterialColor } from '../../lib/types';

interface CycleCount { id: number; scheduledFor: string; completedAt: string | null; }
interface Adjustment { id: number; delta: number; reason: string; note: string | null; createdBy: string | null; createdAt: string; }
const input = 'px-3 py-2.5 bg-bg border border-line rounded-token text-base';

export default function Inventory() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [cc, setCc] = useState<CycleCount | null>(null);
  const [counting, setCounting] = useState(false);
  const [counted, setCounted] = useState<Record<number, string>>({});
  const [nextDate, setNextDate] = useState('');
  const [name, setName] = useState('');
  const [count, setCount] = useState('');
  const [threshold, setThreshold] = useState('');
  const [vendor, setVendor] = useState('');
  // Phase 10, Slice 2: category-aware item entry. ORTHOGONAL to the roll-SKU
  // panel below — picking a category only pre-fills unit/vendor and reveals
  // category-driven fields (color, size); it never touches material/roll state.
  const [categories, setCategories] = useState<Category[]>([]);
  const [unitTypes, setUnitTypes] = useState<string[]>([]);
  const [itemCategoryId, setItemCategoryId] = useState('');
  const [itemUnit, setItemUnit] = useState('');
  const [itemColor, setItemColor] = useState('');
  const [itemSizes, setItemSizes] = useState<CategorySize[]>([]);
  const [itemSize, setItemSize] = useState('');
  const [itemSizeCustom, setItemSizeCustom] = useState('');
  const [itemOrderNote, setItemOrderNote] = useState('');
  const [showReorder, setShowReorder] = useState(false);
  const [reorder, setReorder] = useState<{ name: string; count: number; suggestedQty: number; vendor: string | null; lastCostCents: number | null }[]>([]);
  const [trends, setTrends] = useState<Record<string, Record<string, number>> | null>(null);
  const [error, setError] = useState('');
  // Roll materials still drive the material filter + the roll grouping of
  // existing SKUs (created via seed/import). The manual "Add vinyl roll SKU"
  // panel was removed.
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

  const refresh = () => {
    get<InventoryItem[]>('/api/inventory').then(setItems).catch(() => {});
    get<CycleCount | null>('/api/cycle-counts/next').then(setCc).catch(() => {});
    get<Material[]>('/api/materials?all=1').then(async (m) => {
      const rolls = m.filter((x) => x.usesRoll && x.active);
      setRollMats(rolls);
      // Pull each roll material's color list so the color filter mirrors Materials.
      const entries = await Promise.all(
        rolls.map(async (mm) => [mm.id, (await get<MaterialColor[]>(`/api/materials/${mm.id}/colors`)).map((c) => c.name)] as const),
      );
      setColorsByMat(Object.fromEntries(entries));
    }).catch(() => {});
    // Phase 10, Slice 2: categories + admin-managed unit types, orthogonal to
    // the roll-SKU material data loaded above.
    get<Category[]>('/api/categories').then(setCategories).catch(() => {});
    get<{ units: string[] }>('/api/settings/units').then((u) => setUnitTypes(u.units)).catch(() => {});
  };
  useEffect(() => { refresh(); }, []);

  // Phase 10, Slice 2: when the New item category changes, pre-fill unit
  // (editable) and vendor (only if blank), load that category's size list,
  // and reset the per-category fields so a stale color/size doesn't carry
  // over to the next category picked.
  useEffect(() => {
    setItemSize(''); setItemSizeCustom(''); setItemColor('');
    if (!itemCategoryId) { setItemSizes([]); return; }
    const cat = categories.find((c) => c.id === Number(itemCategoryId));
    if (cat?.defaultUnit) setItemUnit(cat.defaultUnit);
    if (cat?.defaultVendor && !vendor.trim()) setVendor(cat.defaultVendor);
    get<CategorySize[]>(`/api/categories/${itemCategoryId}/sizes`).then(setItemSizes).catch(() => {});
  }, [itemCategoryId]);

  async function add() {
    if (!name.trim()) return setError('Item name required.');
    setError('');
    // sizeText resolves to the free-text "Custom…" entry when chosen, else the
    // selected size from the category's list (or the free Size input when the
    // category has no size list / no category is chosen).
    const sizeText = itemSize === '__custom__' ? itemSizeCustom.trim() : itemSize;
    await post('/api/inventory', {
      name: name.trim(),
      count: Math.max(0, Number(count) || 0),
      lowStockThreshold: Math.max(0, Number(threshold) || 0),
      ...(vendor.trim() ? { vendor: vendor.trim() } : {}),
      ...(itemCategoryId ? { categoryId: Number(itemCategoryId) } : {}),
      // Note: inventory_items has no `unit` column — unit lives on materials.
      // itemUnit only drives the displayed/editable dropdown pre-fill here.
      ...(sizeText.trim() ? { sizeText: sizeText.trim() } : {}),
      ...(itemColor.trim() ? { color: itemColor.trim() } : {}),
      ...(itemOrderNote.trim() ? { orderNote: itemOrderNote.trim() } : {}),
    });
    setName(''); setCount(''); setThreshold(''); setVendor('');
    setItemCategoryId(''); setItemUnit(''); setItemColor(''); setItemSize(''); setItemSizeCustom(''); setItemOrderNote('');
    refresh();
  }

  const [history, setHistory] = useState<{ itemId: number; rows: Adjustment[] } | null>(null);

  async function adjust(item: InventoryItem, delta: number, reason: string, note?: string) {
    setError('');
    try {
      await post(`/api/inventory/${item.id}/adjust`, {
        delta, reason, ...(note ? { note } : {}), ...(currentUser() ? { createdBy: currentUser()! } : {}),
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
    const rows = await get<Adjustment[]>(`/api/inventory/${item.id}/history`);
    setHistory({ itemId: item.id, rows });
  }

  async function scheduleCC() {
    const d = prompt('Schedule cycle count for (YYYY-MM-DD):', new Date().toISOString().slice(0, 10));
    if (!d) return;
    await post('/api/cycle-counts', { scheduledFor: d });
    refresh();
  }

  function startCounting() {
    setCounted(Object.fromEntries(items.map((i) => [i.id, String(i.count)])));
    // Weekly rhythm — the roll-SKU counts depend on it. The server auto-creates
    // the next session (+7 days) even if this field is cleared.
    const next = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    setNextDate(next);
    setCounting(true);
  }

  async function completeCC() {
    if (!cc) return;
    const counts = items.map((i) => ({ itemId: i.id, counted: Math.max(0, Number(counted[i.id]) || 0) }));
    const r = await post<{ itemsAdjusted: number; nextScheduledFor: string }>(`/api/cycle-counts/${cc.id}/complete`, {
      counts, ...(nextDate ? { nextScheduledFor: nextDate } : {}),
    });
    setCounting(false);
    setError('');
    alert(`Cycle count done — ${r.itemsAdjusted} item(s) adjusted. Next count scheduled for ${r.nextScheduledFor}.`);
    refresh();
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
    // Phase 10, Slice 2: resolve categoryName the same way materialName is
    // resolved above — same deactivated-category-falls-to-Other edge case.
    const cat = i.categoryId != null ? categories.find((c) => c.id === i.categoryId) : undefined;
    return {
      id: i.id, name: i.name, count: i.count, lowStockThreshold: i.lowStockThreshold,
      vendor: i.vendor, color: i.color ?? null, nominalWidthIn: i.nominalWidthIn ?? null,
      materialId: i.materialId ?? null, materialName: mat?.name ?? null, unit: mat?.unit ?? null,
      categoryId: i.categoryId ?? null, categoryName: cat?.name ?? null,
    };
  }), [items, rollMats, categories]);

  const view = useMemo(() => buildInventoryView(invItems, {
    search: fSearch, op: fOp, kind: fKind,
    materialId: fMaterial ? Number(fMaterial) : null,
    color: fColor || null,
    widthIn: fWidth ? Number(fWidth) : null,
    lowOnly: fLowOnly, groupBy, sortBy,
    categoryId: fCategory ? Number(fCategory) : null,
  }), [invItems, fSearch, fOp, fKind, fMaterial, fColor, fWidth, fLowOnly, groupBy, sortBy, fCategory]);

  const toggleGroup = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  const select = 'px-3 py-2 bg-bg border border-line rounded-token text-sm';

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">Inventory</h1>
        <div className="flex gap-2">
          {cc && !counting && (
            <button onClick={startCounting}
              className={`px-4 py-2 rounded-token font-semibold ${ccDue ? 'bg-warn text-white' : 'border border-line hover:bg-bg'}`}>
              {ccDue ? 'Cycle count due — start' : `Cycle count ${cc.scheduledFor} — start early`}
            </button>
          )}
          {!cc && <button onClick={scheduleCC} className="px-4 py-2 border border-line rounded-token hover:bg-bg">Schedule cycle count</button>}
          <button onClick={async () => {
            const r = await get<typeof reorder>('/api/inventory/reorder');
            setReorder(r); setShowReorder(true); setTrends(null);
          }} className="px-4 py-2 border border-line rounded-token hover:bg-bg">Reorder report</button>
          <button onClick={async () => {
            const t = await get<Record<string, Record<string, number>>>('/api/inventory/trends');
            setTrends(t); setShowReorder(false);
          }} className="px-4 py-2 border border-line rounded-token hover:bg-bg">Usage trends</button>
        </div>
      </div>
      <p className="text-muted mb-6">Simple unit counts. Every change is logged with a reason.</p>
      {error && <p className="text-danger mb-3">{error}</p>}

      {counting && cc && (
        <div className="bg-surface border-2 border-accent rounded-token p-5 mb-6">
          <h2 className="font-semibold text-lg mb-3">Cycle count — enter what you actually see on the shelf</h2>
          <div className="space-y-2 mb-4">
            {items.map((i) => (
              <div key={i.id} className="flex items-center gap-3">
                <span className="flex-1">{i.name} <span className="text-muted text-sm">(system: {i.count})</span></span>
                <input className={`${input} w-24`} inputMode="numeric" value={counted[i.id] ?? ''}
                  onChange={(e) => setCounted({ ...counted, [i.id]: e.target.value })} />
              </div>
            ))}
          </div>
          <div className="flex gap-3 items-end">
            <div>
              <label className="block text-sm text-muted mb-1">Schedule next count</label>
              <input type="date" className={input} value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
            </div>
            <button onClick={completeCC} className="px-5 py-2.5 bg-accent text-accent-contrast rounded-token font-semibold">Complete count</button>
            <button onClick={() => setCounting(false)} className="px-5 py-2.5 border border-line rounded-token">Cancel</button>
          </div>
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
          <label className="block text-sm text-muted mb-1">Vendor</label>
          <input className={`${input} w-36`} value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Fellers" />
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
                    const low = i.count <= i.lowStockThreshold;
                    const catName = i.categoryId != null ? (categories.find((c) => c.id === i.categoryId)?.name ?? null) : null;
                    const sizeLabel = i.sizeText || (i.nominalWidthIn != null ? `${i.nominalWidthIn}″` : null);
                    return (
                      <div key={i.id} className="flex items-center gap-3 px-4 py-3">
                        <div className="flex-1 flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold">{i.name}</span>
                          {catName && <span className="text-xs px-1.5 py-0.5 rounded-token border border-accent text-accent">{catName}</span>}
                          {i.materialId != null && <span className="text-xs px-1.5 py-0.5 rounded-token border border-line text-muted">roll</span>}
                          {i.color && <span className="text-xs px-1.5 py-0.5 rounded-token border border-line text-muted">{i.color}</span>}
                          {sizeLabel && <span className="text-xs px-1.5 py-0.5 rounded-token border border-line text-muted">{sizeLabel}</span>}
                          {low && <span className="text-xs px-2 py-0.5 rounded-token bg-warn text-white">LOW</span>}
                        </div>
                        <span className={`text-xl font-bold w-16 text-right ${low ? 'text-warn' : ''}`}>{i.count}</span>
                        <span className="text-xs text-muted w-28">reorder at {i.lowStockThreshold}{i.vendor ? ` · ${i.vendor}` : ''}{i.lastCostCents != null ? ` · last $${(i.lastCostCents / 100).toFixed(2)}` : ''}</span>
                        <button onClick={() => adjust(i, -1, 'used')} className="w-10 h-10 border border-line rounded-token text-lg hover:bg-bg">−</button>
                        <button onClick={() => adjust(i, 1, 'received')} className="w-10 h-10 border border-line rounded-token text-lg hover:bg-bg">+</button>
                        <button onClick={async () => {
                          const v = prompt(`Receive how many "${i.name}"?`, '10');
                          const n = Number(v);
                          if (!v || !Number.isInteger(n) || n <= 0) return;
                          const cost = prompt('Unit cost paid ($) — blank to skip:');
                          const cents = cost ? Math.round(Number(cost) * 100) : null;
                          await post(`/api/inventory/${i.id}/adjust`, {
                            delta: n, reason: 'received',
                            ...(cents && cents > 0 ? { unitCostCents: cents } : {}),
                            ...(currentUser() ? { createdBy: currentUser()! } : {}),
                          });
                          refresh();
                        }} className="px-3 h-10 border border-line rounded-token text-sm hover:bg-bg">Receive…</button>
                        <button onClick={() => logDiscrepancy(i)} className="px-3 h-10 border border-warn text-warn rounded-token text-sm hover:bg-bg">Discrepancy</button>
                        <button onClick={() => (history?.itemId === i.id ? setHistory(null) : showHistory(i))}
                          className="px-3 h-10 border border-line rounded-token text-sm hover:bg-bg">Log</button>
                        <button onClick={() => put(`/api/inventory/${i.id}`, { active: false }).then(refresh)}
                          className="px-3 h-10 border border-line rounded-token text-sm text-muted hover:bg-bg">Remove</button>
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
            <h3 className="font-semibold">Reorder report — {reorder.length} item(s) low</h3>
            <div className="flex gap-3">
              <button onClick={() => window.print()} className="text-sm text-accent underline">Print</button>
              <button onClick={() => setShowReorder(false)} className="text-sm text-muted underline">close</button>
            </div>
          </div>
          {reorder.length === 0 && <p className="text-muted">Nothing below threshold. 🎉</p>}
          {reorder.map((r) => (
            <div key={r.name} className="flex gap-3 py-1.5 border-b border-line text-sm">
              <span className="flex-1 font-semibold">{r.name}</span>
              <span className="text-muted">have {r.count}</span>
              <span className="font-bold text-warn">order {r.suggestedQty}</span>
              <span className="text-muted w-32">{r.vendor ?? 'no vendor'}</span>
              <span className="text-muted">{r.lastCostCents != null ? `last $${(r.lastCostCents / 100).toFixed(2)}` : ''}</span>
            </div>
          ))}
        </div>
      )}

      {trends && (
        <div className="bg-surface border border-line rounded-token mt-4 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">Usage by month (units consumed)</h3>
            <button onClick={() => setTrends(null)} className="text-sm text-muted underline">close</button>
          </div>
          {Object.keys(trends).length === 0 && <p className="text-muted">No consumption recorded yet.</p>}
          {Object.entries(trends).map(([item, months]) => (
            <div key={item} className="flex gap-4 py-1.5 border-b border-line text-sm">
              <span className="flex-1 font-semibold">{item}</span>
              {Object.entries(months).sort().map(([m, n]) => (
                <span key={m} className="text-muted">{m}: <b className="text-ink">{n}</b></span>
              ))}
            </div>
          ))}
        </div>
      )}

      {history && (
        <div className="bg-surface border border-line rounded-token mt-4">
          <h3 className="font-semibold px-4 pt-3 pb-1">Change log — {items.find((i) => i.id === history.itemId)?.name}</h3>
          <div className="divide-y divide-line">
            {history.rows.map((a) => (
              <div key={a.id} className="flex gap-3 px-4 py-2 text-sm">
                <span className={`w-12 font-bold ${a.delta < 0 ? 'text-danger' : 'text-ok'}`}>{a.delta > 0 ? '+' : ''}{a.delta}</span>
                <span className="w-28 text-muted">{a.reason}</span>
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
