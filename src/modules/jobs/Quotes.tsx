import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { JOB_TYPES, JOB_TYPE_LABELS, STATUS_LABELS, PRESET_TAGS, ROLL_SIZES, DEFAULT_TAX_RATE_PCT } from '../../../shared/domain';
import { suggestPrice } from '../../../shared/pricing';
import { autoRollWidth } from '../../../shared/rolls';
import { formatCents, parseDollarsToCents, formatDate, formatPhone, isValidPhone, isValidEmail } from '../../lib/format';
import { get, post, put } from '../../lib/api';
import CopyButton from '../../components/CopyButton';
import type { Material, Customer, Job, JobItem, MaterialColor, StockResult } from '../../lib/types';

const DRAFT_KEY = 'dp-erp-quote-draft';

// Color tags are assigned to a specific line (tap-to-assign); other tags are ticket-wide.
const COLOR_TAGS = ['2 color', '3 color'];
const colorLabel = (m: number): string | null => (m >= 3 ? '3 color' : m >= 2 ? '2 color' : null);

interface ItemDraft {
  type: string; title: string; materialId: number | null;
  widthIn: string; heightIn: string; qty: string;
  rollWidthIn: string; rollAuto: boolean; colorMult: number;
  materialColor: string; // vinyl color (variant) for this line's advisory stock check
}
interface Draft {
  clientRef: string;
  title: string; type: string;
  customerName: string; customerPhone: string; customerEmail: string; customerId: number | null; customerLevel: number;
  widthIn: string; heightIn: string; quantity: string; mainColorMult: number;
  rollWidthIn: string; rollAuto: boolean; tags: string[];
  useProofFlow: boolean; dueDate: string;
  materialId: number | null;
  materialColor: string; // chosen vinyl color (variant) for the advisory stock check
  finalPrice: string; notes: string; taxable: boolean; applyDiscount: boolean;
  items: ItemDraft[];
}

const newDraft = (): Draft => ({
  clientRef: crypto.randomUUID(),
  title: '', type: 'decal',
  customerName: '', customerPhone: '', customerEmail: '', customerId: null, customerLevel: 0,
  widthIn: '', heightIn: '', quantity: '1', mainColorMult: 1,
  rollWidthIn: '', rollAuto: true, tags: [],
  useProofFlow: false, dueDate: '',
  materialId: null,
  materialColor: '',
  finalPrice: '', notes: '', taxable: true, applyDiscount: false,
  items: [],
});

const newItem = (type: string): ItemDraft => ({
  type, title: '', materialId: null, widthIn: '', heightIn: '', qty: '1',
  rollWidthIn: '', rollAuto: true, colorMult: 1, materialColor: '',
});

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return { ...newDraft(), ...JSON.parse(raw), items: [] };
  } catch { /* fresh */ }
  return newDraft();
}

export default function Quotes() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [matches, setMatches] = useState<Customer[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [printJob, setPrintJob] = useState<Job | null>(null);
  const [taxRate, setTaxRate] = useState(DEFAULT_TAX_RATE_PCT);
  const [levels, setLevels] = useState<Record<string, number>>({ 1: 5, 2: 10, 3: 15 });
  const [search, setSearch] = useState('');
  const [showRecent, setShowRecent] = useState(true);
  const [assigning, setAssigning] = useState<number | null>(null); // armed color (2 | 3) for tap-to-assign
  const [editing, setEditing] = useState<{ id: number } | null>(null);
  // Phase 8/11: vinyl color lists + advisory stock check for EVERY line.
  const [mainColors, setMainColors] = useState<MaterialColor[]>([]);
  const [mainStock, setMainStock] = useState<StockResult | null>(null);
  const [colorsByMat, setColorsByMat] = useState<Record<number, MaterialColor[]>>({});
  const [itemStocks, setItemStocks] = useState<(StockResult | null)[]>([]);
  // Non-blocking heads-up when the server's quote math disagreed with this screen.
  const [notice, setNotice] = useState('');

  const refresh = (q = '') =>
    get<Job[]>(`/api/jobs?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`).then(setJobs).catch(() => {});

  useEffect(() => {
    // All materials, archived/inactive included, so an existing job still shows
    // the material it was quoted with; the pickers below list only live ones
    // plus whatever this draft already uses (ADR 0005).
    get<Material[]>('/api/materials?all=1&includeArchived=1').then(setMaterials).catch(() => {});
    get<{ ratePct: number }>('/api/settings/tax').then((t) => setTaxRate(t.ratePct)).catch(() => {});
    get<Record<string, number>>('/api/settings/levels').then(setLevels).catch(() => {});
    refresh();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => refresh(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!editing) {
      const { items, ...rest } = draft;
      localStorage.setItem(DRAFT_KEY, JSON.stringify(rest));
    }
  }, [draft, editing]);

  // Customer lookup by name OR phone.
  useEffect(() => {
    const q = draft.customerName.trim();
    if (q.length < 2 || draft.customerId) { setMatches([]); return; }
    const t = setTimeout(() => {
      get<Customer[]>(`/api/customers?q=${encodeURIComponent(q)}`).then(setMatches).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [draft.customerName, draft.customerId]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setItem = (i: number, patch: Partial<ItemDraft>) =>
    set('items', draft.items.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const material = materials.find((m) => m.id === draft.materialId) ?? null;
  const showRoll = !!material?.usesRoll;

  // Phase 8: load the chosen roll material's color list (empty for non-roll).
  useEffect(() => {
    if (!material?.usesRoll) { setMainColors([]); return; }
    get<MaterialColor[]>(`/api/materials/${material.id}/colors`).then(setMainColors).catch(() => setMainColors([]));
  }, [material?.id, material?.usesRoll]);

  // Load color lists for any roll material picked on an additional item (cached per material).
  useEffect(() => {
    const wanted = [...new Set(draft.items
      .map((it) => it.materialId)
      .filter((id): id is number => id != null && !!materials.find((m) => m.id === id)?.usesRoll))]
      .filter((id) => !(id in colorsByMat));
    wanted.forEach((id) => {
      get<MaterialColor[]>(`/api/materials/${id}/colors`)
        .then((c) => setColorsByMat((prev) => ({ ...prev, [id]: c })))
        .catch(() => setColorsByMat((prev) => ({ ...prev, [id]: [] })));
    });
  }, [draft.items, materials]); // eslint-disable-line react-hooks/exhaustive-deps

  // Phase 8/11: advisory stock check for EVERY line (main + items) in ONE
  // batched request (debounced) — lookup only, never blocks a quote.
  useEffect(() => {
    const mainActive = showRoll && !!draft.materialColor && !!draft.materialId;
    const itemActive = draft.items.map((it) =>
      !!it.materialColor && !!it.materialId && !!materials.find((m) => m.id === it.materialId)?.usesRoll);
    if (!mainActive && !itemActive.some(Boolean)) { setMainStock(null); setItemStocks([]); return; }

    const t = setTimeout(() => {
      // Line 0 is always the main item; inactive lines get no material → 'unknown'.
      const lines = [
        mainActive
          ? { materialId: draft.materialId, color: draft.materialColor, widthIn: Number(draft.widthIn) || null, heightIn: Number(draft.heightIn) || null }
          : { materialId: null, color: '' },
        ...draft.items.map((it, i) => (itemActive[i]
          ? { materialId: it.materialId, color: it.materialColor, widthIn: Number(it.widthIn) || null, heightIn: Number(it.heightIn) || null }
          : { materialId: null, color: '' })),
      ];
      post<{ results: StockResult[] }>('/api/stock-check/batch', { lines })
        .then(({ results }) => {
          setMainStock(mainActive ? results[0] : null);
          setItemStocks(results.slice(1).map((r, i) => (itemActive[i] ? r : null)));
        })
        .catch(() => { setMainStock(null); setItemStocks([]); });
    }, 250);
    return () => clearTimeout(t);
  }, [showRoll, draft.materialId, draft.materialColor, draft.widthIn, draft.heightIn, draft.items, materials]);
  const isNewCustomer = !draft.customerId && draft.customerName.trim().length > 0;
  const inUse = new Set([draft.materialId, ...draft.items.map((it) => it.materialId)]);
  const isLive = (m: Material) => m.active && !m.archivedAt;
  const pickable = materials.filter((m) => isLive(m) || inUse.has(m.id));
  const addons = pickable.filter((m) => m.isAddon);
  const regularMaterials = pickable.filter((m) => !m.isAddon);

  // ---- Roll auto-select (derived; manual pick sets rollAuto=false) ----
  const autoMainRoll = showRoll ? autoRollWidth(Number(draft.widthIn) || null, Number(draft.heightIn) || null) : null;
  const effMainRoll = showRoll ? (draft.rollAuto ? autoMainRoll : (Number(draft.rollWidthIn) || null)) : null;
  const itemRoll = (it: ItemDraft): number | null => {
    const m = materials.find((x) => x.id === it.materialId);
    if (!m?.usesRoll) return null;
    return it.rollAuto ? autoRollWidth(Number(it.widthIn) || null, Number(it.heightIn) || null) : (Number(it.rollWidthIn) || null);
  };

  const canColor = (m: Material | null | undefined): boolean =>
    !!m && m.colorMultiplier !== false && m.priceMode !== 'custom';

  // ---- Price book suggestions (per line, with this line's color) ----
  const suggested = useMemo(() => {
    if (!material) return null;
    return suggestPrice(material, {
      widthIn: Number(draft.widthIn) || undefined,
      heightIn: Number(draft.heightIn) || undefined,
      qty: Number(draft.quantity) || 1,
      colorMult: draft.mainColorMult,
    });
  }, [material, draft.widthIn, draft.heightIn, draft.quantity, draft.mainColorMult]);

  const itemSuggestions = useMemo(() => draft.items.map((it) => {
    const m = materials.find((x) => x.id === it.materialId);
    if (!m) return null;
    return suggestPrice(m, {
      widthIn: Number(it.widthIn) || undefined,
      heightIn: Number(it.heightIn) || undefined,
      qty: Number(it.qty) || 1,
      colorMult: it.colorMult,
    });
  }), [draft.items, materials]);

  const combinedSuggested = (suggested ?? 0) + itemSuggestions.reduce((acc: number, x) => acc + (x ?? 0), 0);
  const anySuggestion = suggested != null || itemSuggestions.some((x) => x != null);

  function useSuggestions() {
    // Fill Price with the whole suggested total (main + items), ready to adjust.
    if (anySuggestion) set('finalPrice', (combinedSuggested / 100).toFixed(2));
  }

  // ---- Totals: subtotal → +tax (default on) → −level discount (after tax) ----
  // The manual Price is the full pre-tax total. The suggestion (incl. additional
  // items) is advisory only — we never add line items on top of what the user typed.
  const baseCents = parseDollarsToCents(draft.finalPrice) ?? 0;
  const subtotal = baseCents;
  const taxCents = draft.taxable ? Math.round(subtotal * taxRate / 100) : 0;
  const discountPct = draft.applyDiscount && draft.customerLevel > 0 ? (levels[String(draft.customerLevel)] ?? 0) : 0;
  const discountCents = Math.round((subtotal + taxCents) * discountPct / 100);
  const grandTotal = subtotal + taxCents - discountCents;

  // ---- Ticket-wide tag chips: ticket tags + any colors assigned to a line ----
  const assignedColors = useMemo(() => {
    const s = new Set<string>();
    const a = colorLabel(draft.mainColorMult); if (a) s.add(a);
    draft.items.forEach((it) => { const l = colorLabel(it.colorMult); if (l) s.add(l); });
    return [...s];
  }, [draft.mainColorMult, draft.items]);
  const ticketTags = [...draft.tags, ...assignedColors];

  useEffect(() => {
    if (printJob) {
      const t = setTimeout(() => { window.print(); setPrintJob(null); }, 60);
      return () => clearTimeout(t);
    }
  }, [printJob]);

  function toggleTag(t: string) {
    set('tags', draft.tags.includes(t) ? draft.tags.filter((x) => x !== t) : [...draft.tags, t]);
  }

  // Assign the armed color to a line (main = -1, items = index). No-op if unsupported.
  function assignColorTo(lineIdx: number) {
    if (assigning == null) return;
    if (lineIdx < 0) { if (canColor(material)) set('mainColorMult', assigning); }
    else { const m = materials.find((x) => x.id === draft.items[lineIdx]?.materialId); if (canColor(m)) setItem(lineIdx, { colorMult: assigning }); }
    setAssigning(null);
  }

  function buildPayload(status?: 'quote' | 'acknowledged') {
    return {
      ...(draft.customerId
        ? { customerId: draft.customerId }
        : { newCustomer: { name: draft.customerName.trim(), phone: draft.customerPhone.trim(), email: draft.customerEmail.trim() } }),
      type: draft.type,
      title: draft.title.trim(),
      ...(status ? { status } : {}),
      useProofFlow: draft.useProofFlow,
      ...(draft.dueDate ? { dueDate: draft.dueDate } : {}),
      quantity: Number(draft.quantity) || 1,
      ...(Number(draft.widthIn) > 0 ? { widthIn: Number(draft.widthIn) } : {}),
      ...(Number(draft.heightIn) > 0 ? { heightIn: Number(draft.heightIn) } : {}),
      mainColorMult: draft.mainColorMult,
      ...(effMainRoll ? { rollWidthIn: effMainRoll } : {}),
      ...(ticketTags.length ? { tags: ticketTags.join(', ') } : {}),
      ...(draft.materialId ? { materialId: draft.materialId } : {}),
      ...(anySuggestion ? { suggestedPriceCents: combinedSuggested } : {}),
      finalPriceCents: parseDollarsToCents(draft.finalPrice)!,
      taxable: draft.taxable,
      ...(discountPct > 0 ? { discountPct } : {}),
      totalCents: grandTotal,
      ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
      items: draft.items
        .filter((it) => it.title.trim())
        .map((it, i) => ({
          type: it.type, title: it.title.trim(),
          qty: Number(it.qty) || 1,
          // Per-piece price from the line total (0 = custom, priced in the main field).
          priceCents: itemSuggestions[i] != null ? Math.round(itemSuggestions[i]! / (Number(it.qty) || 1)) : 0,
          colorMult: it.colorMult,
          ...(it.materialId ? { materialId: it.materialId } : {}),
          ...(Number(it.widthIn) > 0 ? { widthIn: Number(it.widthIn) } : {}),
          ...(Number(it.heightIn) > 0 ? { heightIn: Number(it.heightIn) } : {}),
          ...(itemRoll(it) ? { rollWidthIn: itemRoll(it)! } : {}),
        })),
    };
  }

  function validate(): string | null {
    if (!draft.title.trim()) return 'Job title is required.';
    if (!draft.customerName.trim()) return 'Customer is required.';
    if (!draft.customerId && !isValidPhone(draft.customerPhone)) return 'A full 10-digit phone number is required for new customers.';
    if (!draft.customerId && !isValidEmail(draft.customerEmail)) return 'An email address is required for new customers.';
    if (!draft.materialId) return 'Material / price rule is required.';
    if (!(Number(draft.quantity) > 0)) return 'Quantity is required.';
    if (!draft.dueDate) return 'Due date is required.';
    if (parseDollarsToCents(draft.finalPrice) === null) return 'Enter a valid price (e.g. 45 or 45.00).';
    return null;
  }

  // Server-side quote-math re-check (Phase 11): the server recomputes the
  // suggested total and grand total with ITS settings and stores its own
  // answer. If this screen disagreed (stale tab, changed tax rate), surface a
  // heads-up — the job saved fine, but the stored numbers are the server's.
  interface PriceCheck { verified: boolean; serverTotalCents: number; clientTotalCents: number | null; }
  function noteMismatch(pc?: PriceCheck) {
    if (!pc || pc.verified) { setNotice(''); return; }
    const server = (pc.serverTotalCents / 100).toFixed(2);
    setNotice(`Heads up: the server recalculated this quote and stored $${server} as the total — this screen's math was out of date (old tax rate or pricing settings). Refresh the page to pick up current settings.`);
  }

  async function save(status: 'quote' | 'acknowledged') {
    const v = validate(); if (v) return setError(v);
    setError(''); setSaving(true);
    try {
      const saved = await post<Job & { items: JobItem[]; priceCheck?: PriceCheck }>('/api/jobs', {
        clientRef: draft.clientRef,
        ...buildPayload(status),
      });
      noteMismatch(saved.priceCheck);
      localStorage.removeItem(DRAFT_KEY);
      setDraft(newDraft());
      refresh(search.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed — safe to retry.');
    } finally { setSaving(false); }
  }

  async function saveEdit() {
    if (!editing) return;
    const v = validate(); if (v) return setError(v);
    setError(''); setSaving(true);
    try {
      const saved = await put<Job & { items: JobItem[]; priceCheck?: PriceCheck }>(`/api/jobs/${editing.id}`, {
        ...buildPayload(),
      });
      noteMismatch(saved.priceCheck);
      setEditing(null);
      setDraft(loadDraft());
      refresh(search.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Edit failed.');
    } finally { setSaving(false); }
  }

  async function startEdit(j: Job) {
    // The signed-in session is the edit attribution (ADR 0004) — no re-prompt.
    const full = await get<Job & { items: JobItem[] }>(`/api/jobs/${j.id}`);
    setEditing({ id: j.id });
    setDraft({
      clientRef: crypto.randomUUID(),
      title: full.title, type: full.type,
      customerName: full.customerName ?? '', customerPhone: full.customerPhone ?? '',
      customerEmail: '', // existing customer — email lives on their account
      customerId: full.customerId, customerLevel: 0,
      widthIn: full.widthIn?.toString() ?? '', heightIn: full.heightIn?.toString() ?? '',
      quantity: String(full.quantity),
      mainColorMult: full.mainColorMult ?? 1,
      rollWidthIn: full.rollWidthIn?.toString() ?? '', rollAuto: full.rollWidthIn == null,
      tags: full.tags ? full.tags.split(',').map((t) => t.trim()).filter((t) => t && !COLOR_TAGS.includes(t)) : [],
      useProofFlow: full.useProofFlow, dueDate: full.dueDate ?? '',
      materialId: full.materialId,
      materialColor: '',
      finalPrice: full.finalPriceCents != null ? (full.finalPriceCents / 100).toFixed(2) : '',
      notes: full.notes ?? '', taxable: full.taxable,
      applyDiscount: (full.discountPct ?? 0) > 0,
      items: (full.items ?? []).map((it) => ({
        type: it.type, title: it.title, materialId: it.materialId,
        widthIn: it.widthIn?.toString() ?? '', heightIn: it.heightIn?.toString() ?? '',
        qty: String(it.qty),
        rollWidthIn: it.rollWidthIn?.toString() ?? '',
        rollAuto: it.rollWidthIn == null, colorMult: it.colorMult ?? 1, materialColor: '',
      })),
    });
    window.scrollTo(0, 0);
  }

  async function convert(id: number) {
    try { await post(`/api/jobs/${id}/convert`, {}); refresh(search.trim()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Convert failed'); }
  }

  const input = 'w-full px-3 py-2.5 bg-bg border border-line rounded-token text-base';
  const small = 'px-2 py-2 bg-bg border border-line rounded-token text-sm';
  const label = 'block text-sm text-muted mb-1';

  // Lines shown in the suggestion box — also the tap targets for color assignment.
  const lines = [
    { key: 'main', label: draft.title.trim() || 'Main item', price: suggested, colorMult: draft.mainColorMult, allowed: canColor(material), idx: -1 },
    ...draft.items.map((it, i) => ({
      key: 'i' + i, label: it.title || `Item ${i + 1}`, price: itemSuggestions[i],
      colorMult: it.colorMult, allowed: canColor(materials.find((x) => x.id === it.materialId)), idx: i,
    })),
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Quotes</h1>
      <div className={`grid gap-6 ${showRecent ? 'xl:grid-cols-[560px_1fr]' : ''}`}>
        <section className="bg-surface border border-line rounded-token p-5 self-start">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-lg">{editing ? `Editing job #${editing.id}` : 'New Quote'}</h2>
            {editing && (
              <button onClick={() => { setEditing(null); setDraft(loadDraft()); }}
                className="text-sm text-danger underline">cancel edit</button>
            )}
          </div>

          <div className="mb-3">
            <label className={label}>Job title *</label>
            <input className={input} value={draft.title} onChange={(e) => set('title', e.target.value)}
              placeholder="Van door decals x2" autoFocus />
          </div>

          {/* Customer — phone only appears for a new (unmatched) customer */}
          <div className="mb-3">
            <label className={label}>Customer * <span className="text-xs">(search name or phone)</span></label>
            <div className="relative">
              <input className={input} value={draft.customerName}
                onChange={(e) => { set('customerName', e.target.value); set('customerId', null); set('customerLevel', 0); set('applyDiscount', false); }}
                placeholder="Name or phone" />
              {matches.length > 0 && (
                <div className="absolute z-10 left-0 right-0 bg-surface border border-line rounded-token mt-1 shadow">
                  {matches.map((c) => (
                    <button key={c.id} type="button"
                      className="block w-full text-left px-3 py-2 hover:bg-bg"
                      onClick={() => {
                        set('customerName', c.name); set('customerPhone', c.phone ?? '');
                        set('customerId', c.id); set('customerLevel', c.level ?? 0);
                        setMatches([]);
                      }}>
                      {c.name} <span className="text-muted text-sm">{c.phone}{(c.level ?? 0) > 0 ? ` · L${c.level}` : ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {isNewCustomer && (
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className={label}>Phone * <span className="text-xs">(required for new customers)</span></label>
                <input className={input} value={draft.customerPhone} inputMode="tel" maxLength={16}
                  onChange={(e) => set('customerPhone', formatPhone(e.target.value))}
                  placeholder="(123) 456 - 7890" />
              </div>
              <div>
                <label className={label}>Email * <span className="text-xs">(required for new customers)</span></label>
                <input className={input} value={draft.customerEmail} inputMode="email" maxLength={120}
                  onChange={(e) => set('customerEmail', e.target.value)}
                  placeholder="name@example.com" />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className={label}>Job type *</label>
              <select className={input} value={draft.type} onChange={(e) => set('type', e.target.value)}>
                {JOB_TYPES.map((t) => <option key={t} value={t}>{JOB_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Material / price rule *</label>
              <select className={input} value={draft.materialId ?? ''}
                onChange={(e) => setDraft({ ...draft, materialId: e.target.value ? Number(e.target.value) : null, materialColor: '' })}>
                <option value="">— pick —</option>
                {regularMaterials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>

          {/* Phase 8: vinyl color (a material variant — does NOT change price). Only
              shown when the chosen roll material has colors set up on Materials. */}
          {showRoll && mainColors.length > 0 && (
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className={label}>Vinyl color</label>
                <select className={input} value={draft.materialColor}
                  onChange={(e) => set('materialColor', e.target.value)}>
                  <option value="">— pick to check stock —</option>
                  {mainColors.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-4 gap-3 mb-3">
            <div>
              <label className={label}>Width (in)</label>
              <input className={input} inputMode="decimal" value={draft.widthIn} onChange={(e) => set('widthIn', e.target.value)} />
            </div>
            <div>
              <label className={label}>Height (in)</label>
              <input className={input} inputMode="decimal" value={draft.heightIn} onChange={(e) => set('heightIn', e.target.value)} />
            </div>
            <div>
              <label className={label}>Qty *</label>
              <input className={input} inputMode="numeric" value={draft.quantity} onChange={(e) => set('quantity', e.target.value)} />
            </div>
            <div>
              <label className={label}>Due date *</label>
              <input type="date" className={input} value={draft.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            {showRoll && (
              <div>
                <label className={label}>
                  Roll {draft.rollAuto
                    ? <span className="text-xs text-ok">· auto</span>
                    : <button type="button" className="text-xs text-accent underline" onClick={() => set('rollAuto', true)}>· auto</button>}
                </label>
                <select className={`${input} ${mainStock?.state === 'suboptimal' ? 'border-warn' : ''}`} value={effMainRoll ?? ''}
                  onChange={(e) => { set('rollAuto', false); set('rollWidthIn', e.target.value); }}>
                  <option value="">—</option>
                  {ROLL_SIZES.map((r) => {
                    const inStock = mainStock?.fittingInStock?.includes(r);
                    return <option key={r} value={r}>{r}″{inStock ? ' · in stock' : ''}</option>;
                  })}
                </select>
              </div>
            )}
          </div>

          {/* Phase 8: advisory stock signal — never blocks the quote. */}
          {showRoll && draft.materialColor && mainStock && mainStock.state !== 'unknown' && (
            <div className={`mb-3 px-3 py-2 rounded-token text-sm border ${
              mainStock.state === 'in_stock' ? 'border-ok text-ok'
                : mainStock.state === 'suboptimal' ? 'border-warn text-warn'
                  : 'border-danger text-danger'}`}>
              {mainStock.state === 'in_stock' && <>✓ {draft.materialColor} in stock{mainStock.useWidth ? ` — ${mainStock.useWidth}″ roll` : ''}.</>}
              {mainStock.state === 'suboptimal' && <>⚠ {mainStock.message}</>}
              {mainStock.state === 'out_of_stock' && <>⛔ {mainStock.message}</>}
            </div>
          )}

          {/* ---- Additional items ---- */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <label className={label}>Additional items</label>
              <button type="button" className="text-sm text-accent underline"
                onClick={() => set('items', [...draft.items, newItem(draft.type)])}>
                + Add item
              </button>
            </div>
            {addons.some(isLive) && (
              <div className="flex flex-wrap gap-2 mb-2">
                {addons.filter(isLive).map((a) => (
                  <button key={a.id} type="button"
                    className="px-2.5 py-1 text-xs rounded-token border border-line text-muted hover:bg-bg"
                    onClick={() => set('items', [...draft.items, { ...newItem(draft.type), title: a.name, materialId: a.id }])}>
                    + {a.name}
                  </button>
                ))}
              </div>
            )}
            {draft.items.map((it, i) => {
              const im = materials.find((x) => x.id === it.materialId);
              const showItemRoll = !!im?.usesRoll;
              const itemColors = showItemRoll ? (colorsByMat[im!.id] ?? []) : [];
              const iStock = itemStocks[i] ?? null;
              return (
                <div key={i} className="border border-line rounded-token p-2 mb-2">
                  <div className="flex gap-2 mb-2">
                    <select className={`${small} w-28`} value={it.type} onChange={(e) => setItem(i, { type: e.target.value })}>
                      {JOB_TYPES.map((t) => <option key={t} value={t}>{JOB_TYPE_LABELS[t]}</option>)}
                    </select>
                    <input className={`${small} flex-1`} placeholder="Item description"
                      value={it.title} onChange={(e) => setItem(i, { title: e.target.value })} />
                    <button type="button" className="px-2 text-danger" onClick={() => set('items', draft.items.filter((_, j) => j !== i))}>✕</button>
                  </div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <select className={`${small} w-40`} value={it.materialId ?? ''}
                      onChange={(e) => setItem(i, { materialId: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">material —</option>
                      <optgroup label="Materials">
                        {regularMaterials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </optgroup>
                      {addons.length > 0 && (
                        <optgroup label="Add-ons">
                          {addons.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </optgroup>
                      )}
                    </select>
                    <input className={`${small} w-14`} inputMode="decimal" placeholder="W″"
                      value={it.widthIn} onChange={(e) => setItem(i, { widthIn: e.target.value })} />
                    <input className={`${small} w-14`} inputMode="decimal" placeholder="H″"
                      value={it.heightIn} onChange={(e) => setItem(i, { heightIn: e.target.value })} />
                    <label className="flex items-center gap-1 text-sm text-muted">Qty
                      <input className={`${small} w-14 text-center`} inputMode="numeric"
                        value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} />
                    </label>
                    {showItemRoll && (
                      <select className={`${small} ${iStock?.state === 'suboptimal' ? 'border-warn' : ''}`} value={itemRoll(it) ?? ''}
                        onChange={(e) => setItem(i, { rollAuto: false, rollWidthIn: e.target.value })}>
                        <option value="">roll —</option>
                        {ROLL_SIZES.map((r) => {
                          const inStock = iStock?.fittingInStock?.includes(r);
                          return <option key={r} value={r}>{r}″{inStock ? ' · in stock' : it.rollAuto ? ' (auto)' : ''}</option>;
                        })}
                      </select>
                    )}
                    {showItemRoll && itemColors.length > 0 && (
                      <select className={small} value={it.materialColor}
                        onChange={(e) => setItem(i, { materialColor: e.target.value })}>
                        <option value="">color — check stock</option>
                        {itemColors.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
                    )}
                  </div>
                  {/* Advisory per-line stock signal — same three states as the main item. */}
                  {iStock && iStock.state !== 'unknown' && (
                    <div className={`mt-2 text-xs ${
                      iStock.state === 'in_stock' ? 'text-ok'
                        : iStock.state === 'suboptimal' ? 'text-warn'
                          : 'text-danger'}`}>
                      {iStock.state === 'in_stock' && <>✓ {it.materialColor} in stock{iStock.useWidth ? ` — ${iStock.useWidth}″ roll` : ''}.</>}
                      {iStock.state === 'suboptimal' && <>⚠ {iStock.message}</>}
                      {iStock.state === 'out_of_stock' && <>⛔ {iStock.message}</>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ---- Suggestion + per-line color assignment (tap a tag, then tap a line) ---- */}
          <div className="border border-line rounded-token p-3 mb-3 bg-bg">
            {assigning != null && (
              <div className="text-sm text-accent mb-2">Tap a line below to apply <b>{assigning} color ×{assigning}</b> · <button type="button" className="underline" onClick={() => setAssigning(null)}>cancel</button></div>
            )}
            {anySuggestion ? (
              <>
                <div className="space-y-1 mb-2">
                  {lines.map((ln) => (
                    <div key={ln.key}
                      onClick={() => assigning != null && assignColorTo(ln.idx)}
                      className={`flex items-center justify-between text-sm rounded-token px-1 ${assigning != null ? (ln.allowed ? 'cursor-pointer ring-1 ring-accent/40 hover:bg-surface' : 'opacity-40') : ''}`}>
                      <span className="text-muted">{ln.label}</span>
                      <span className="flex items-center gap-2">
                        {ln.colorMult > 1 && (
                          <button type="button" title="clear color"
                            onClick={(e) => { e.stopPropagation(); ln.idx < 0 ? set('mainColorMult', 1) : setItem(ln.idx, { colorMult: 1 }); }}
                            className="px-1.5 py-0.5 text-xs rounded-token bg-accent text-accent-contrast">×{ln.colorMult} ✕</button>
                        )}
                        <span>{ln.price != null ? formatCents(ln.price) : 'custom — in main price'}</span>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex items-baseline justify-between border-t border-line pt-2">
                  <span className="text-sm text-muted">Suggested total</span>
                  <span>
                    <span className="text-xl font-bold">{formatCents(combinedSuggested)}</span>
                    <button type="button" className="ml-3 px-3 py-1.5 text-sm bg-accent text-accent-contrast rounded-token"
                      onClick={useSuggestions}>Use</button>
                  </span>
                </div>
              </>
            ) : (
              <span className="text-sm text-muted">
                {material ? (material.priceMode === 'custom' ? 'Custom pricing — set manually.' : 'Enter size/qty for a suggestion.') : 'Pick a material above for price suggestions.'}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3 items-end">
            <div>
              <label className={label}>Price * ($)</label>
              <input className={`${input} text-lg font-semibold`} inputMode="decimal" value={draft.finalPrice}
                onChange={(e) => set('finalPrice', e.target.value)} placeholder="45.00" />
            </div>
            <label className="flex items-center gap-2 py-2.5 text-base">
              <input type="checkbox" className="w-5 h-5" checked={draft.useProofFlow}
                onChange={(e) => set('useProofFlow', e.target.checked)} />
              Needs design/proof approval
            </label>
          </div>

          {/* ---- Totals: tax on by default; discount after tax for level 1+ ---- */}
          <div className="border border-line rounded-token p-3 mb-3 bg-bg">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-2 text-base">
                  <input type="checkbox" className="w-5 h-5" checked={draft.taxable} onChange={(e) => set('taxable', e.target.checked)} />
                  Tax ({taxRate}%)
                </label>
                {draft.customerLevel > 0 && (
                  <label className="flex items-center gap-2 text-base">
                    <input type="checkbox" className="w-5 h-5" checked={draft.applyDiscount} onChange={(e) => set('applyDiscount', e.target.checked)} />
                    Level {draft.customerLevel} discount ({levels[String(draft.customerLevel)] ?? 0}%)
                  </label>
                )}
              </div>
              <div className="text-right text-sm">
                <div className="text-muted">Subtotal {formatCents(subtotal)}</div>
                {draft.taxable && <div className="text-muted">Tax {formatCents(taxCents)}</div>}
                {discountCents > 0 && <div className="text-ok">Discount −{formatCents(discountCents)}</div>}
                <div className="text-xl font-bold">{formatCents(grandTotal)}</div>
              </div>
            </div>
          </div>

          {/* ---- Notes ---- */}
          <div className="mb-3">
            <label className={label}>Notes</label>
            <textarea className={input} rows={4} value={draft.notes} onChange={(e) => set('notes', e.target.value)}
              placeholder="Placement, colors, customer-supplied stock, anything the shop needs…" />
          </div>

          {/* ---- Tags: color tags arm tap-to-assign; others toggle ticket-wide ---- */}
          <div className="mb-1 flex flex-wrap gap-2">
            {PRESET_TAGS.map((t) => {
              if (COLOR_TAGS.includes(t)) {
                const armed = assigning === (t === '3 color' ? 3 : 2);
                return (
                  <button key={t} type="button"
                    onClick={() => setAssigning(armed ? null : (t === '3 color' ? 3 : 2))}
                    className={`px-3 py-1.5 text-sm rounded-token border ${armed ? 'bg-accent text-accent-contrast border-accent' : 'border-dashed border-accent text-accent hover:bg-bg'}`}>
                    {t} {armed ? '· tap a line' : '↦'}
                  </button>
                );
              }
              return (
                <button key={t} type="button" onClick={() => toggleTag(t)}
                  className={`px-3 py-1.5 text-sm rounded-token border ${draft.tags.includes(t) ? 'bg-accent text-accent-contrast border-accent' : 'border-line hover:bg-bg'}`}>
                  {t}
                </button>
              );
            })}
            {draft.tags.filter((t) => !(PRESET_TAGS as readonly string[]).includes(t)).map((t) => (
              <button key={t} type="button" onClick={() => toggleTag(t)}
                className="px-3 py-1.5 text-sm rounded-token border bg-accent text-accent-contrast border-accent">
                {t} ✕
              </button>
            ))}
            <button type="button" className="px-3 py-1.5 text-sm rounded-token border border-dashed border-line text-muted hover:bg-bg"
              onClick={() => { const t = prompt('Custom tag:'); if (t?.trim()) toggleTag(t.trim()); }}>
              + custom
            </button>
          </div>
          {ticketTags.length > 0 && (
            <p className="text-xs text-muted mb-4">On ticket: {ticketTags.join(' · ')}</p>
          )}

          {error && <p className="text-danger mb-3">{error}</p>}
          {notice && (
            <p className="text-warn text-sm mb-3">
              {notice} <button type="button" className="underline" onClick={() => setNotice('')}>dismiss</button>
            </p>
          )}

          {editing ? (
            <button disabled={saving} onClick={saveEdit}
              className="w-full py-3 bg-accent text-accent-contrast rounded-token font-semibold disabled:opacity-50">
              Save changes
            </button>
          ) : (
            <div className="flex gap-3">
              <button disabled={saving} onClick={() => save('quote')}
                className="flex-1 py-3 border border-accent text-accent rounded-token font-semibold disabled:opacity-50">
                Save as Quote
              </button>
              {!draft.useProofFlow && (
                <button disabled={saving} onClick={() => save('acknowledged')}
                  className="flex-1 py-3 bg-accent text-accent-contrast rounded-token font-semibold disabled:opacity-50">
                  Create Order
                </button>
              )}
            </div>
          )}
          {draft.useProofFlow && !editing && (
            <p className="text-xs text-muted mt-2">Proof jobs start as quotes — convert after the customer approves.</p>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h2 className="font-semibold text-lg">Recent</h2>
              <button onClick={() => setShowRecent((s) => !s)} className="text-sm text-accent underline">
                {showRecent ? 'hide' : 'show'}
              </button>
            </div>
            {showRecent && (
              <input className="px-3 py-2 bg-surface border border-line rounded-token text-sm w-64"
                placeholder="Search title / PO / tag / customer…" value={search} onChange={(e) => setSearch(e.target.value)} />
            )}
          </div>
          {showRecent && (
            <div className="space-y-2">
              {jobs.map((j) => (
                <div key={j.id} className="bg-surface border border-line rounded-token p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{j.title} {j.po && <span className="text-xs text-muted font-normal">· {j.po}</span>}</div>
                    <div className="text-sm text-muted truncate">
                      {j.customerName ?? 'No customer'} · {JOB_TYPE_LABELS[j.type as never] ?? j.type} · due {formatDate(j.dueDate)}
                    </div>
                  </div>
                  <span className="text-xs px-2 py-1 rounded-token border border-line text-muted shrink-0">
                    {STATUS_LABELS[j.status as never] ?? j.status}
                  </span>
                  <div className="text-right shrink-0">
                    <div className="font-bold">{formatCents(j.totalCents ?? j.finalPriceCents ?? 0)}</div>
                    {j.suggestedPriceCents != null && (
                      <div className="text-xs text-muted">sugg. {formatCents(j.suggestedPriceCents)}</div>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {j.po && <CopyButton text={j.po} label="Copy PO" />}
                    {j.status === 'quote' && (
                      <button onClick={() => convert(j.id)}
                        className="px-3 py-2 text-sm bg-accent text-accent-contrast rounded-token">Convert</button>
                    )}
                    <button onClick={() => startEdit(j)}
                      className="px-3 py-2 text-sm border border-line rounded-token hover:bg-bg">Edit</button>
                    <button onClick={() => setPrintJob(j)}
                      className="px-3 py-2 text-sm border border-line rounded-token hover:bg-bg">Print</button>
                  </div>
                </div>
              ))}
              {jobs.length === 0 && <p className="text-muted">No jobs found.</p>}
            </div>
          )}
        </section>
      </div>

      {printJob && createPortal(
        <div className="print-sheet">
          <h1 style={{ fontSize: 24, marginBottom: 2 }}>Decals Plus</h1>
          <p style={{ margin: '0 0 16px', color: '#555' }}>{printJob.po ?? `#${printJob.id}`} — {formatDate(printJob.createdAt)}{printJob.createdBy ? ` — by ${printJob.createdBy}` : ''}</p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <tbody>
              {[
                ['Customer', `${printJob.customerName ?? '—'}${printJob.customerPhone ? ' · ' + printJob.customerPhone : ''}`],
                ['Job', printJob.title],
                ['Type', JOB_TYPE_LABELS[printJob.type as never] ?? printJob.type],
                ['Size / Qty', `${printJob.widthIn ?? '—'}″ × ${printJob.heightIn ?? '—'}″ · qty ${printJob.quantity}${printJob.rollWidthIn ? ` · ${printJob.rollWidthIn}″ roll` : ''}`],
                ['Material', printJob.materialName ?? '—'],
                ['Due date', formatDate(printJob.dueDate)],
                ['Tags', printJob.tags ?? '—'],
                ['Notes', printJob.notes ?? '—'],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td style={{ border: '1px solid #ccc', padding: '6px 10px', width: 130, color: '#555' }}>{k}</td>
                  <td style={{ border: '1px solid #ccc', padding: '6px 10px' }}>{v}</td>
                </tr>
              ))}
              <tr>
                <td style={{ border: '1px solid #ccc', padding: '8px 10px', fontWeight: 700 }}>Total{printJob.taxable ? ' (tax incl.)' : ''}{printJob.discountPct ? ` (−${printJob.discountPct}%)` : ''}</td>
                <td style={{ border: '1px solid #ccc', padding: '8px 10px', fontWeight: 700, fontSize: 18 }}>
                  {formatCents(printJob.totalCents ?? printJob.finalPriceCents ?? 0)}
                </td>
              </tr>
            </tbody>
          </table>
          <p style={{ marginTop: 16, fontSize: 12, color: '#777' }}>Quote valid 30 days. Thank you for your business!</p>
        </div>,
        document.body,
      )}
    </div>
  );
}
