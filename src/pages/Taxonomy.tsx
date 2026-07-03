import { useEffect, useState } from 'react';
import { get, put, post, del } from '../lib/api';
import { ui } from '../lib/ui';
import AdminGate from '../components/AdminGate';
import type { Category, CategorySize } from '../lib/types';

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

  useEffect(() => { refresh(); }, []);

  const refresh = async () => {
    try {
      const u = await get<{ units: string[] }>('/api/settings/units');
      setUnits(u.units);
      const cats = await get<Category[]>('/api/categories?all=1');
      setCategories(cats);
      const entries = await Promise.all(
        cats.map(async (c) => [c.id, await get<CategorySize[]>(`/api/categories/${c.id}/sizes`)] as const),
      );
      setSizesByCat(Object.fromEntries(entries));
    } catch (e) { setInvError(e instanceof Error ? e.message : 'Load failed'); }
  };

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
        name: c.name, defaultUnit: c.defaultUnit, tracksColor: c.tracksColor, defaultVendor: c.defaultVendor,
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
    const ap = prompt(`Admin password to remove "${c.name}"?\nItems keep their data — they just lose this category.`);
    if (ap === null) return;
    setInvError('');
    try { await del(`/api/categories/${c.id}`, { adminPassword: ap }); refresh(); }
    catch (e) { setInvError(e instanceof Error ? e.message : 'Remove failed (wrong admin password?)'); }
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
      <h1 className="text-2xl font-bold mb-2">Inventory Categories &amp; Units</h1>
      <AdminGate>
      <p className="text-muted mb-6">Unit types and smart categories organize inventory. Neither changes pricing or the estimator's stock check.</p>
      {invError && <p className="text-danger mb-3">{invError}</p>}

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
                <button onClick={() => removeCategory(c)} className={`${ui.btnSm} text-danger`}>Remove</button>
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
                <label className="text-sm text-muted">Default vendor
                  <input className={`${ui.inputSm} w-32 ml-1`} value={c.defaultVendor ?? ''}
                    onChange={(e) => setLocalCat(c.id, { defaultVendor: e.target.value || null })} />
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
      </AdminGate>
    </div>
  );
}
