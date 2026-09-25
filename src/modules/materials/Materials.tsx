// Price book admin: every material's pricing rule is fully editable here.
import { useEffect, useState } from 'react';
import { MATERIAL_UNITS, PRICE_MODES, PRICE_MODE_LABELS, type PriceMode } from '../../../shared/domain';
import { formatCents, parseDollarsToCents } from '../../lib/format';
import { get, post, put, del } from '../../lib/api';
import type { Material } from '../../lib/types';
import RoleGate from '../../components/RoleGate';

const input = 'px-3 py-2.5 bg-bg border border-line rounded-token text-base';
const small = 'px-2 py-1.5 bg-bg border border-line rounded-token text-sm';

interface MaterialColor { id: number; materialId: number; name: string; }

export default function Materials() {
  const [items, setItems] = useState<Material[]>([]);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('sqft');
  const [error, setError] = useState('');
  const [savedId, setSavedId] = useState<number | null>(null);
  // Phase 8: admin-managed color list per roll material (a material *variant*,
  // not the 2/3-color price tag — color never changes price).
  const [colors, setColors] = useState<Record<number, MaterialColor[]>>({});
  const [colorInput, setColorInput] = useState<Record<number, string>>({});
  const [matSearch, setMatSearch] = useState('');

  const refresh = async () => {
    try {
      const mats = await get<Material[]>('/api/materials?all=1');
      setItems(mats);
      const rollMats = mats.filter((m) => m.usesRoll);
      const entries = await Promise.all(
        rollMats.map(async (m) => [m.id, await get<MaterialColor[]>(`/api/materials/${m.id}/colors`)] as const),
      );
      setColors(Object.fromEntries(entries));
    } catch { /* ignore */ }
  };
  useEffect(() => { refresh(); }, []);

  async function addColor(materialId: number) {
    const cn = (colorInput[materialId] ?? '').trim();
    if (!cn) return;
    setError('');
    try {
      await post(`/api/materials/${materialId}/colors`, { name: cn });
      setColorInput({ ...colorInput, [materialId]: '' });
      refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Add color failed'); }
  }
  async function removeColor(materialId: number, colorId: number) {
    setError('');
    try { await del(`/api/materials/${materialId}/colors/${colorId}`); refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Remove color failed'); }
  }

  async function add() {
    if (!name.trim()) return setError('Name is required.');
    setError('');
    await post('/api/materials', { name: name.trim(), unit, costPerUnitCents: 0, priceMode: 'custom', rateCents: 0 });
    setName(''); refresh();
  }

  const setLocal = (id: number, patch: Partial<Material>) =>
    setItems(items.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  async function saveRow(m: Material) {
    setError('');
    try {
      await put(`/api/materials/${m.id}`, {
        priceMode: m.priceMode, rateCents: m.rateCents,
        minQty: m.minQty, colorMultiplier: m.colorMultiplier,
        usesRoll: m.usesRoll, isAddon: m.isAddon,
      });
      setSavedId(m.id);
      setTimeout(() => setSavedId(null), 1500);
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
  }

  async function remove(m: Material) {
    if (!confirm(`Remove "${m.name}" from materials? This can't be undone.`)) return;
    setError('');
    try {
      await del(`/api/materials/${m.id}`);
      refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Remove failed'); }
  }

  function rateLabel(mode: string): string {
    switch (mode) {
      case 'per_inch_max': return '$/inch';
      case 'per_sqft': return '$/sqft';
      case 'per_unit': return '$/unit';
      case 'flat': return '$ base';
      default: return '$';
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Materials & Price Book</h1>
      <RoleGate min="admin">
      <p className="text-muted mb-6">Each material carries its pricing rule. "2 color" doubles, "3 color" triples (when enabled). Changes affect new quotes only.</p>

      <div className="bg-surface border border-line rounded-token p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-48">
          <label className="block text-sm text-muted mb-1">New material</label>
          <input className={`${input} w-full`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Reflective vinyl" />
        </div>
        <div>
          <label className="block text-sm text-muted mb-1">Unit</label>
          <select className={input} value={unit} onChange={(e) => setUnit(e.target.value)}>
            {MATERIAL_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <button onClick={add} className="px-5 py-2.5 bg-accent text-accent-contrast rounded-token font-semibold">Add</button>
      </div>
      {error && <p className="text-danger mb-3">{error}</p>}

      <input className={`${input} w-full mb-2`} placeholder="Search materials…" value={matSearch}
        onChange={(e) => setMatSearch(e.target.value)} />
      <div className="space-y-2">
        {items.filter((m) => m.name.toLowerCase().includes(matSearch.trim().toLowerCase())).map((m) => (
          <div key={m.id} className={`bg-surface border border-line rounded-token p-3 ${m.active ? '' : 'opacity-50'}`}>
            <div className="flex items-center gap-3 mb-2">
              <span className="font-semibold flex-1">
                {m.name} <span className="text-muted text-sm font-normal">({m.unit})</span>
                {m.usesRoll && <span className="ml-2 text-xs px-1.5 py-0.5 rounded-token border border-line text-muted">roll</span>}
                {m.isAddon && <span className="ml-1 text-xs px-1.5 py-0.5 rounded-token border border-line text-muted">add-on</span>}
              </span>
              {m.priceMode !== 'custom' && m.rateCents > 0 && (
                <span className="text-sm text-muted">
                  {formatCents(m.rateCents)} {rateLabel(m.priceMode).replace('$', '')}
                </span>
              )}
              <button onClick={() => put(`/api/materials/${m.id}`, { active: !m.active }).then(refresh)}
                className="px-3 py-1.5 text-sm border border-line rounded-token hover:bg-bg">
                {m.active ? 'Deactivate' : 'Reactivate'}
              </button>
              <button onClick={() => remove(m)}
                className="px-3 py-1.5 text-sm border border-line rounded-token text-danger hover:bg-bg">
                Remove
              </button>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <select className={small} value={m.priceMode}
                onChange={(e) => setLocal(m.id, { priceMode: e.target.value as PriceMode })}>
                {PRICE_MODES.map((p) => <option key={p} value={p}>{PRICE_MODE_LABELS[p]}</option>)}
              </select>
              {m.priceMode !== 'custom' && (
                <>
                  <label className="text-sm text-muted">{rateLabel(m.priceMode)}
                    <input className={`${small} w-20 ml-1`} inputMode="decimal"
                      value={(m.rateCents / 100).toString()}
                      onChange={(e) => setLocal(m.id, { rateCents: parseDollarsToCents(e.target.value) ?? 0 })} />
                  </label>
                  <label className="text-sm text-muted">Min qty
                    <input className={`${small} w-14 ml-1`} inputMode="numeric"
                      value={m.minQty}
                      onChange={(e) => setLocal(m.id, { minQty: Math.max(1, Number(e.target.value) || 1) })} />
                  </label>
                  <label className="flex items-center gap-1.5 text-sm text-muted">
                    <input type="checkbox" checked={m.colorMultiplier}
                      onChange={(e) => setLocal(m.id, { colorMultiplier: e.target.checked })} />
                    ×2/×3 color
                  </label>
                </>
              )}
              <label className="flex items-center gap-1.5 text-sm text-muted">
                <input type="checkbox" checked={m.usesRoll}
                  onChange={(e) => setLocal(m.id, { usesRoll: e.target.checked })} />
                Vinyl roll
              </label>
              <label className="flex items-center gap-1.5 text-sm text-muted">
                <input type="checkbox" checked={m.isAddon}
                  onChange={(e) => setLocal(m.id, { isAddon: e.target.checked })} />
                Add-on
              </label>
              <button onClick={() => saveRow(m)}
                className="px-4 py-1.5 text-sm bg-accent text-accent-contrast rounded-token font-semibold ml-auto">
                {savedId === m.id ? 'Saved ✓' : 'Save'}
              </button>
            </div>
            {m.usesRoll && (
              <div className="mt-2 pt-2 border-t border-line flex flex-wrap gap-2 items-center">
                <span className="text-sm text-muted">Colors:</span>
                {(colors[m.id] ?? []).map((c) => (
                  <span key={c.id} className="text-sm px-2 py-0.5 rounded-token border border-line flex items-center gap-1">
                    {c.name}
                    <button onClick={() => removeColor(m.id, c.id)} className="text-muted hover:text-danger" title="Remove color">×</button>
                  </span>
                ))}
                {(colors[m.id] ?? []).length === 0 && <span className="text-sm text-muted italic">none yet</span>}
                <input className={`${small} w-28`} placeholder="Add color" value={colorInput[m.id] ?? ''}
                  onChange={(e) => setColorInput({ ...colorInput, [m.id]: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') addColor(m.id); }} />
                <button onClick={() => addColor(m.id)} className="px-2 py-1 text-sm border border-line rounded-token hover:bg-bg">Add color</button>
              </div>
            )}
          </div>
        ))}
        {items.length === 0 && <p className="text-muted">No materials yet.</p>}
      </div>
      </RoleGate>
    </div>
  );
}
