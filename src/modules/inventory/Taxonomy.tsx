import { useEffect, useState } from 'react';
import { get, put, post, del } from '../../lib/api';
import { ui } from '../../lib/ui';
import RoleGate from '../../components/RoleGate';
import { hasRole } from '../../lib/session';
import type { Category, CategorySize, Supplier } from '../../lib/types';

// Inventory taxonomy admin (units & smart categories). Moved out of Settings
// into its own page (2026-07-02) — linked from Settings > Admin, the same way
// Materials is. ORTHOGONAL to the roll-SKU/estimator path on Materials.tsx —
// nothing here changes pricing or the advisory stock check.
export default function Taxonomy() {
  const [units, setUnits] = useState<string[]>([]);
  const [unitInput, setUnitInput] = useState('');
  const [unitsSaved, setUnitsSaved] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [catName, setCatName] = useState('');
  const [sizesByCat, setSizesByCat] = useState<Record<number, CategorySize[]>>({});
  const [sizeInput, setSizeInput] = useState<Record<number, string>>({});
  const [catSearch, setCatSearch] = useState('');
  const [invError, setInvError] = useState('');
  // Suppliers (2026-07-07): the source of truth replacing free-text vendors.
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supName, setSupName] = useState('');
  const [supLead, setSupLead] = useState('7');
  const [supContact, setSupContact] = useState('');

  useEffect(() => { refresh(); }, []);

  const refresh = async () => {
    try {
      const u = await get<{ units: string[] }>('/api/settings/units');
      setUnits(u.units);
      const cats = await get<Category[]>('/api/categories?all=1');
      setCategories(cats);
      setSuppliers(await get<Supplier[]>('/api/suppliers?all=1'));
      const entries = await Promise.all(
        cats.map(async (c) => [c.id, await get<CategorySize[]>(`/api/categories/${c.id}/sizes`)] as const),
      );
      setSizesByCat(Object.fromEntries(entries));
    } catch (e) { setInvError(e instanceof Error ? e.message : 'Load failed'); }
  };

  async function addSupplier() {
    if (!supName.trim()) return setInvError('Supplier name required.');
    setInvError('');
    try {
      await post('/api/suppliers', {
        name: supName.trim(),
        leadTimeDays: Math.max(0, Number(supLead) || 7),
        ...(supContact.trim() ? { contact: supContact.trim() } : {}),
      });
      setSupName(''); setSupLead('7'); setSupContact('');
      refresh();
    } catch (e) { setInvError(e instanceof Error ? e.message : 'Add supplier failed'); }
  }

  const setLocalSup = (id: number, patch: Partial<Supplier>) =>
    setSuppliers(suppliers.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  async function saveSupplier(s: Supplier) {
    setInvError('');
    try {
      await put(`/api/suppliers/${s.id}`, {
        name: s.name, leadTimeDays: s.leadTimeDays, contact: s.contact,
      });
      refresh();
    } catch (e) { setInvError(e instanceof Error ? e.message : 'Save failed'); }
  }

  async function toggleSupplier(s: Supplier) {
    setInvError('');
    try { await put(`/api/suppliers/${s.id}`, { active: !s.active }); refresh(); }
    catch (e) { setInvError(e instanceof Error ? e.message : 'Update failed'); }
  }

  async function removeSupplier(s: Supplier) {
    if (!confirm(`Remove "${s.name}"?\nBlocked if it has receiving history — deactivate instead.`)) return;
    setInvError('');
    try { await del(`/api/suppliers/${s.id}`, {}); refresh(); }
    catch (e) { setInvError(e instanceof Error ? e.message : 'Remove failed'); }
  }

  async function saveUnits(next: string[]) {
    setInvError('');
    try {
      const r = await put<{ units: string[] }>('/api/settings/units', { units: next });
      setUnits(r.units);
      setUnitsSaved(true);
      setTimeout(() => setUnitsSaved(false), 1500);
    } catch (e) { setInvError(e instanceof Error ? e.message : 'Save failed'); }
  }

  function addUnit() {
    const u = unitInput.trim();
    if (!u) return;
    if (units.some((x) => x.toLowerCase() === u.toLowerCase())) { setUnitInput(''); return; }
    saveUnits([...units, u]);
    setUnitInput('');
  }
  function removeUnit(u: string) {
    saveUnits(units.filter((x) => x !== u));
  }

  async function addCategory() {
    if (!catName.trim()) return setInvError('Category name required.');
    setInvError('');
    try {
      await post('/api/categories', { name: catName.trim() });
      setCatName('');
      refresh();
    } catch (e) { setInvError(e instanceof Error ? e.message : 'Add category failed'); }
  }

  const setLocalCat = (id: number, patch: Partial<Category>) =>
    setCategories(categories.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  async function saveCategory(c: Category) {
    setInvError('');
    try {
      await put(`/api/categories/${c.id}`, {
        // defaultVendor (free text) is retired — defaultSupplierId is the
        // source of truth now; the old text stays in the DB for history only.
        name: c.name, defaultUnit: c.defaultUnit, tracksColor: c.tracksColor,
        defaultSupplierId: c.defaultSupplierId,
      });
      refresh();
    } catch (e) { setInvError(e instanceof Error ? e.message : 'Save failed'); }
  }

  async function toggleActive(c: Category) {
    setInvError('');
    try { await put(`/api/categories/${c.id}`, { active: !c.active }); refresh(); }
    catch (e) { setInvError(e instanceof Error ? e.message : 'Update failed'); }
  }

  async function removeCategory(c: Category) {
    if (!confirm(`Remove "${c.name}"?\nItems keep their data — they just lose this category.`)) return;
    setInvError('');
    try { await del(`/api/categories/${c.id}`, {}); refresh(); }
    catch (e) { setInvError(e instanceof Error ? e.message : 'Remove failed'); }
  }

  async function addSize(categoryId: number) {
    const label = (sizeInput[categoryId] ?? '').trim();
    if (!label) return;
    setInvError('');
    try {
      await post(`/api/categories/${categoryId}/sizes`, { label });
      setSizeInput({ ...sizeInput, [categoryId]: '' });
      refresh();
    } catch (e) { setInvError(e instanceof Error ? e.message : 'Add size failed'); }
  }
  async function removeSize(categoryId: number, sizeId: number) {
    setInvError('');
    try { await del(`/api/categories/${categoryId}/sizes/${sizeId}`); refresh(); }
    catch (e) { setInvError(e instanceof Error ? e.message : 'Remove size failed'); }
  }

  const activeCats = categories.filter((c) => c.active);
  const inactiveCats = categories.filter((c) => !c.active);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Inventory Categories, Units &amp; Suppliers</h1>
      <RoleGate min="manager">
      <p className="text-muted mb-6">Unit types, smart categories, and suppliers organize inventory. None of it changes pricing or the estimator's stock check.</p>
      {invError && <p className="text-danger mb-3">{invError}</p>}

      <section className={`${ui.card} mb-4`}>
        <h2 className="font-semibold text-lg mb-1">Suppliers</h2>
        <p className="text-sm text-muted mb-3">Lead time feeds the AUTO reorder-point suggestion on the Inventory page (usage/day × lead + buffer). Receipts record which supplier stock actually came from.</p>
        <div className="space-y-2 mb-4">
          {suppliers.map((s) => (
            <div key={s.id} className={`border border-line rounded-token p-3 flex flex-wrap items-center gap-2 ${s.active ? '' : 'opacity-50'}`}>
              <input className={`${ui.inputSm} flex-1 min-w-32 font-semibold`} value={s.name}
                onChange={(e) => setLocalSup(s.id, { name: e.target.value })} />
              <label className="text-sm text-muted">Lead (days)
                <input className={`${ui.inputSm} w-16 ml-1`} inputMode="numeric" value={s.leadTimeDays}
                  onChange={(e) => setLocalSup(s.id, { leadTimeDays: Math.max(0, Number(e.target.value) || 0) })} />
              </label>
              <input className={`${ui.inputSm} w-44`} placeholder="Contact (phone / email / rep)" value={s.contact ?? ''}
                onChange={(e) => setLocalSup(s.id, { contact: e.target.value || null })} />
              <button onClick={() => saveSupplier(s)} className={ui.btnSm}>Save</button>
              <button onClick={() => toggleSupplier(s)} className={ui.btnSm}>{s.active ? 'Deactivate' : 'Reactivate'}</button>
              {hasRole('admin') && <button onClick={() => removeSupplier(s)} className={`${ui.btnSm} text-danger`}>Remove</button>}
            </div>
          ))}
          {suppliers.length === 0 && <p className="text-muted">No suppliers yet — add the first one below.</p>}
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-40">
            <label className={ui.label}>New supplier</label>
            <input className={ui.input} placeholder="Fellers" value={supName}
              onChange={(e) => setSupName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addSupplier(); }} />
          </div>
          <div>
            <label className={ui.label}>Lead time (days)</label>
            <input className={`${ui.input} w-24`} inputMode="numeric" value={supLead}
              onChange={(e) => setSupLead(e.target.value)} />
          </div>
          <div>
            <label className={ui.label}>Contact</label>
            <input className={`${ui.input} w-44`} placeholder="Optional" value={supContact}
              onChange={(e) => setSupContact(e.target.value)} />
          </div>
          <button onClick={addSupplier} className={ui.btnPrimary}>Add</button>
        </div>
      </section>

      <section className={`${ui.card} mb-4`}>
        <h2 className="font-semibold text-lg mb-1">Unit types</h2>
        <p className="text-sm text-muted mb-3">Used on Materials and Inventory item entry. Editing this list doesn't change anything already saved.</p>
        <div className="flex flex-wrap gap-2 items-center mb-3">
          {units.map((u) => (
            <span key={u} className={`${ui.chip} flex items-center gap-1.5`}>
              {u}
              <button onClick={() => removeUnit(u)} className="text-muted hover:text-danger" title="Remove unit">×</button>
            </span>
          ))}
          {units.length === 0 && <span className="text-sm text-muted italic">none yet</span>}
        </div>
        <div className="flex gap-2 items-center">
          <input className={`${ui.inputSm} w-36`} placeholder="Add unit (e.g. roll)" value={unitInput}
            onChange={(e) => setUnitInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addUnit(); }} />
          <button onClick={addUnit} className={ui.btnSm}>Add</button>
          {unitsSaved && <span className="text-ok text-sm">Saved ✓</span>}
        </div>
      </section>

      <section className={`${ui.card} mb-4`}>
        <h2 className="font-semibold text-lg mb-1">Categories</h2>
        <p className="text-sm text-muted mb-3">Smart categories pre-fill the unit/vendor when adding inventory and group items on the Inventory page. Orthogonal to vinyl roll SKUs — color tracking here is a separate flag from the price-book color list.</p>

        <div className="flex gap-2 items-end mb-4">
          <div className="flex-1">
            <label className={ui.label}>New category</label>
            <input className={`${ui.input}`} placeholder="Apparel blanks" value={catName}
              onChange={(e) => setCatName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addCategory(); }} />
          </div>
          <button onClick={addCategory} className={ui.btnPrimary}>Add</button>
        </div>

        <input className={`${ui.inputSm} w-full mb-3`} placeholder="Search categories…" value={catSearch}
          onChange={(e) => setCatSearch(e.target.value)} />

        <div className="space-y-2">
          {[...activeCats, ...inactiveCats].filter((c) => c.name.toLowerCase().includes(catSearch.trim().toLowerCase())).map((c) => (
            <div key={c.id} className={`border border-line rounded-token p-3 ${c.active ? '' : 'opacity-50'}`}>
              <div className="flex items-center gap-2 mb-2">
                <input className={`${ui.inputSm} flex-1 font-semibold`} value={c.name}
                  onChange={(e) => setLocalCat(c.id, { name: e.target.value })} />
                <button onClick={() => toggleActive(c)} className={ui.btnSm}>
                  {c.active ? 'Deactivate' : 'Reactivate'}
                </button>
                {hasRole('admin') && <button onClick={() => removeCategory(c)} className={`${ui.btnSm} text-danger`}>Remove</button>}
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <label className="text-sm text-muted">Default unit
                  <select className={`${ui.inputSm} ml-1`} value={c.defaultUnit ?? ''}
                    onChange={(e) => setLocalCat(c.id, { defaultUnit: e.target.value || null })}>
                    <option value="">—</option>
                    {units.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-sm text-muted">
                  <input type="checkbox" checked={c.tracksColor}
                    onChange={(e) => setLocalCat(c.id, { tracksColor: e.target.checked })} />
                  Tracks color
                </label>
                <label className="text-sm text-muted">Default supplier
                  <select className={`${ui.inputSm} ml-1`} value={c.defaultSupplierId ?? ''}
                    onChange={(e) => setLocalCat(c.id, { defaultSupplierId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">—</option>
                    {suppliers.filter((s) => s.active || s.id === c.defaultSupplierId).map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </label>
                <button onClick={() => saveCategory(c)} className={`${ui.btnSm} ml-auto`}>Save</button>
              </div>
              <div className="mt-2 pt-2 border-t border-line flex flex-wrap gap-2 items-center">
                <span className="text-sm text-muted">Sizes:</span>
                {(sizesByCat[c.id] ?? []).map((s) => (
                  <span key={s.id} className={`${ui.chip} flex items-center gap-1`}>
                    {s.label}
                    <button onClick={() => removeSize(c.id, s.id)} className="text-muted hover:text-danger" title="Remove size">×</button>
                  </span>
                ))}
                {(sizesByCat[c.id] ?? []).length === 0 && <span className="text-sm text-muted italic">none yet</span>}
                <input className={`${ui.inputSm} w-24`} placeholder="Add size" value={sizeInput[c.id] ?? ''}
                  onChange={(e) => setSizeInput({ ...sizeInput, [c.id]: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') addSize(c.id); }} />
                <button onClick={() => addSize(c.id)} className={ui.btnSm}>Add size</button>
              </div>
            </div>
          ))}
          {categories.length === 0 && <p className="text-muted">No categories yet — add the first one above.</p>}
        </div>
      </section>
      </RoleGate>
    </div>
  );
}
