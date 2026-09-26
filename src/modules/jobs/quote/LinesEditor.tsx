// The quote's lines. Each is priced on its own (per-line color multiplier).
// Keyboard: Enter in any line field adds a line and puts the cursor in it.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button, Card, CardHeader, Chip } from '../../../components/m3';
import type { Material } from '../../../lib/types';
import { newLine, type LineDraft } from './draft';
import LineRow from './LineRow';
import type { useLineStock } from './useLineStock';

interface Props {
  lines: LineDraft[];
  jobType: string;
  materials: Material[];
  suggestions: (number | null)[];
  stock: ReturnType<typeof useLineStock>;
  locked: boolean;
  onLines: (lines: LineDraft[]) => void;
}

const isLive = (m: Material) => m.active && !m.archivedAt;

export default function LinesEditor({ lines, jobType, materials, suggestions, stock, locked, onLines }: Props) {
  const list = useRef<HTMLOListElement>(null);
  const [focusLine, setFocusLine] = useState<number | null>(null);
  const inUse = new Set(lines.map((l) => l.materialId));
  const pickable = materials.filter((m) => isLive(m) || inUse.has(m.id));
  const regular = pickable.filter((m) => !m.isAddon);
  const addons = pickable.filter((m) => m.isAddon);

  useEffect(() => {
    if (focusLine == null) return;
    list.current?.querySelector<HTMLElement>(`[data-line="${focusLine}"] [data-first]`)?.focus();
    setFocusLine(null);
  }, [focusLine]);

  const add = (over: Partial<LineDraft> = {}) => { onLines([...lines, newLine(jobType, over)]); setFocusLine(lines.length); };
  const patch = (i: number, p: Partial<LineDraft>) => onLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const remove = (i: number) => { onLines(lines.filter((_, j) => j !== i)); setFocusLine(null); };

  const onKeyDown = (e: KeyboardEvent<HTMLOListElement>) => {
    const t = e.target as HTMLElement;
    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || locked || t.tagName !== 'INPUT') return;
    e.preventDefault();
    add();
  };

  return (
    <Card variant="outlined" aria-labelledby="quote-lines-h">
      <CardHeader id="quote-lines-h" title="Lines"
        subtitle={locked ? 'Invoiced — lines are locked.' : 'Each line is priced on its own. Press Enter in a line to add another.'} />
      <ol ref={list} className="flex flex-col gap-3" onKeyDown={onKeyDown}>
        {lines.map((l, i) => {
          const m = materials.find((x) => x.id === l.materialId) ?? null;
          return (
            <LineRow key={l.key} line={l} index={i} materials={regular} addons={addons} material={m}
              suggestion={suggestions[i] ?? null} stock={stock.stockAt(i)} colors={stock.colorsFor(m?.usesRoll ? m.id : null)}
              locked={locked} onChange={(p) => patch(i, p)} onRemove={i > 0 ? () => remove(i) : undefined} />
          );
        })}
      </ol>
      {!locked && (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <Button variant="tonal" icon="add" onClick={() => add()}>Add line</Button>
          {addons.filter(isLive).map((a) => (
            <Chip key={a.id} icon="add" onClick={() => add({ title: a.name, materialId: a.id })}>{a.name}</Chip>
          ))}
        </div>
      )}
    </Card>
  );
}
