// One priced line: material / price rule, size, qty, color multiplier, roll, vinyl color.
import { IconButton, Select, TextField } from '../../../components/m3';
import { formatCents } from '../../../lib/format';
import type { Material, MaterialColor, StockResult } from '../../../lib/types';
import { JOB_TYPES, JOB_TYPE_LABELS, ROLL_SIZES } from '../../../../shared/domain';
import type { LineDraft } from './draft';
import { canColor, effectiveRoll } from './math';
import StockNote from './StockNote';

interface Props {
  line: LineDraft;
  index: number;
  materials: Material[];
  addons: Material[];
  material: Material | null;
  suggestion: number | null;
  stock: StockResult | null;
  colors: MaterialColor[];
  locked: boolean;
  onChange: (patch: Partial<LineDraft>) => void;
  onRemove?: () => void;
}

export default function LineRow({ line, index, materials, addons, material, suggestion, stock, colors, locked, onChange, onRemove }: Props) {
  const main = index === 0;
  const roll = !!material?.usesRoll;
  const autoRoll = effectiveRoll({ ...line, rollAuto: true }, material);
  const n = index + 1;
  return (
    <li data-line={index} className="rounded-shape-small border border-outline-variant p-3 list-none">
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-title-small flex-1">{main ? 'Main item' : `Line ${n}`}</h3>
        <span className="text-body-medium text-on-surface-variant" aria-label={`Line ${n} suggested price`}>
          {suggestion != null ? formatCents(suggestion) : material ? (material.priceMode === 'custom' ? 'Custom — in Price' : 'Enter size/qty') : '—'}
        </span>
        {onRemove && !locked && <IconButton icon="close" label={`Remove line ${n}`} onClick={onRemove} />}
      </div>
      {!main && (
        <div className="grid gap-2 sm:grid-cols-[11rem_minmax(0,1fr)] mb-2">
          <Select label="Type" value={line.type} disabled={locked} onChange={(e) => onChange({ type: e.target.value })}>
            {JOB_TYPES.map((t) => <option key={t} value={t}>{JOB_TYPE_LABELS[t]}</option>)}
          </Select>
          <TextField label="Description" value={line.title} disabled={locked} data-first maxLength={200}
            placeholder={material?.name ?? 'e.g. Back window decal'} onChange={(e) => onChange({ title: e.target.value })} />
        </div>
      )}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 lg:grid-cols-[minmax(11rem,2fr)_repeat(3,minmax(4.5rem,1fr))_minmax(7.5rem,1.2fr)]">
        <Select label={main ? 'Material / price rule *' : 'Material'} value={line.materialId ?? ''} disabled={locked}
          className="col-span-2 sm:col-span-4 lg:col-span-1" {...(main ? { 'data-first': true } : {})}
          onChange={(e) => onChange({ materialId: e.target.value ? Number(e.target.value) : null, materialColor: '' })}>
          <option value="">{main ? '— pick —' : 'none'}</option>
          <optgroup label="Materials">{materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>
          {!main && addons.length > 0 && <optgroup label="Add-ons">{addons.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>}
        </Select>
        <TextField label="Width (in)" inputMode="decimal" value={line.widthIn} disabled={locked} onChange={(e) => onChange({ widthIn: e.target.value })} />
        <TextField label="Height (in)" inputMode="decimal" value={line.heightIn} disabled={locked} onChange={(e) => onChange({ heightIn: e.target.value })} />
        <TextField label={main ? 'Qty *' : 'Qty'} inputMode="numeric" value={line.qty} disabled={locked} onChange={(e) => onChange({ qty: e.target.value })} />
        <Select label="Colors (price)" value={line.colorMult} disabled={locked || !canColor(material)}
          title={canColor(material) ? 'Color multiplier for this line only' : 'This material ignores the color multiplier'}
          onChange={(e) => onChange({ colorMult: Number(e.target.value) })}>
          <option value={1}>1 color</option>
          <option value={2}>2 color ×2</option>
          <option value={3}>3 color ×3</option>
        </Select>
        {roll && (
          <Select label="Roll width" value={line.rollAuto ? 'auto' : line.rollWidthIn} disabled={locked}
            className={stock?.state === 'suboptimal' ? 'ring-2 ring-warning rounded-shape-extra-small' : undefined}
            onChange={(e) => onChange(e.target.value === 'auto' ? { rollAuto: true } : { rollAuto: false, rollWidthIn: e.target.value })}>
            <option value="auto">Auto{autoRoll ? ` — ${autoRoll}″` : ''}</option>
            {ROLL_SIZES.map((r) => <option key={r} value={r}>{r}″{stock?.fittingInStock?.includes(r) ? ' · in stock' : ''}</option>)}
          </Select>
        )}
        {roll && colors.length > 0 && (
          <Select label="Vinyl color (stock check)" value={line.materialColor} className="col-span-2 sm:col-span-1"
            onChange={(e) => onChange({ materialColor: e.target.value })}>
            <option value="">— pick to check stock —</option>
            {colors.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </Select>
        )}
      </div>
      {roll && <StockNote stock={stock} color={line.materialColor} />}
    </li>
  );
}
