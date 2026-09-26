// Customer lookup by name or phone — a combobox: type, ↑/↓ to choose, Enter to pick, Esc to close.
import { forwardRef, useEffect, useId, useState, type KeyboardEvent } from 'react';
import { TextField, cx } from '../../../components/m3';
import { get } from '../../../lib/api';
import type { Page } from '../../../lib/query';
import type { Customer } from '../../../lib/types';

interface Props {
  value: string;
  onText: (text: string) => void;
  onPick: (c: Customer) => void;
  /** A customer is chosen — stop suggesting. */
  picked: boolean;
  label?: string;
  supportingText?: string;
  error?: string | null;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
}

const CustomerSearch = forwardRef<HTMLInputElement, Props>(function CustomerSearch(
  { value, onText, onPick, picked, label = 'Customer (name or phone)', supportingText, error, autoFocus, disabled, className }, ref,
) {
  const id = useId();
  const [matches, setMatches] = useState<Customer[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2 || picked) { setMatches([]); return; }
    let live = true;
    const t = setTimeout(() => {
      // Paged search: the server sends only the first 10 matches, never the whole table.
      get<Page<Customer>>(`/api/customers?q=${encodeURIComponent(q)}&limit=10&offset=0`)
        .then((p) => { if (live) { setMatches(p.rows.slice(0, 8)); setActive(0); setOpen(true); } })
        .catch(() => { if (live) setMatches([]); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [value, picked]);

  const shown = open && !picked && matches.length > 0;
  const pick = (c: Customer) => { onPick(c); setOpen(false); setMatches([]); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!shown) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % matches.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(matches[active]); }
    else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
  };

  return (
    <div className={cx('relative', className)}>
      <TextField ref={ref} label={label} value={value} autoFocus={autoFocus} disabled={disabled} autoComplete="off"
        supportingText={supportingText} error={error} leadingIcon="search"
        role="combobox" aria-expanded={shown} aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-activedescendant={shown ? `${id}-${active}` : undefined}
        onChange={(e) => { onText(e.target.value); setOpen(true); }} onKeyDown={onKey} onBlur={() => setOpen(false)} />
      {shown && (
        <ul id={`${id}-list`} role="listbox" aria-label="Matching customers"
          className="absolute z-20 left-0 right-0 mt-1 py-2 rounded-shape-extra-small bg-surface-container shadow-elevation-2 max-h-80 overflow-auto">
          {matches.map((c, i) => (
            <li key={c.id} id={`${id}-${i}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(c); }} onMouseEnter={() => setActive(i)}
              className={cx('px-4 min-h-12 flex items-center gap-3 cursor-pointer text-body-large',
                i === active ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface')}>
              <span className="flex-1 truncate">{c.name}</span>
              <span className={cx('text-body-medium', i === active ? 'text-on-secondary-container' : 'text-on-surface-variant')}>
                {c.phone}{(c.level ?? 0) > 0 ? ` · L${c.level}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
export default CustomerSearch;
