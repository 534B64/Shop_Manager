import { Button, Chip, cx } from '../../../components/m3';
import { formatCents } from '../../../lib/format';
import { changeCents } from '../../../../shared/invoice';
import { digitsToCents, keypadPress, quickTenders, centsToDigits, type KeypadKey } from './keypad';

const KEYS: KeypadKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'back'];
const KEY_LABEL: Partial<Record<KeypadKey, string>> = { back: '⌫' };

/** Cash tendered: register-style keypad (digits fill from the right), quick amounts, change due. */
export default function CashKeypad({ totalCents, digits, onDigits }: {
  totalCents: number; digits: string; onDigits: (d: string) => void;
}) {
  const tendered = digitsToCents(digits);
  const change = tendered > 0 ? changeCents(totalCents, tendered) : null;
  const short = tendered > 0 && change == null ? totalCents - tendered : 0;
  const press = (k: KeypadKey) => onDigits(keypadPress(digits, k));

  return (
    <div className="flex flex-col gap-3">
      <label className="block">
        <span className="text-title-small text-on-surface-variant">Cash tendered</span>
        {/* Read-only on touch (the keypad types); a physical keyboard types too. */}
        <input readOnly inputMode="none" aria-describedby="change-due"
          className="block w-full h-16 px-4 mt-1 rounded-shape-small bg-surface-container-highest text-on-surface text-display-small text-right tabular-nums"
          value={formatCents(tendered)}
          onKeyDown={(e) => {
            if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key as KeypadKey); }
            else if (e.key === 'Backspace') { e.preventDefault(); press('back'); }
            else if (e.key === 'Delete' || e.key === 'Escape') { e.preventDefault(); press('clear'); }
          }} />
      </label>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Quick amounts">
        {quickTenders(totalCents).map((c, i) => (
          <Chip key={c} touch kind="filter" selected={tendered === c} onClick={() => onDigits(centsToDigits(c))}>
            {i === 0 ? `Exact ${formatCents(c)}` : formatCents(c)}
          </Chip>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Keypad">
        {KEYS.map((k) => (
          <Button key={k} variant="tonal" touch className="!h-14 !text-title-large" aria-label={k === 'back' ? 'Delete last digit' : undefined}
            onClick={() => press(k)}>{KEY_LABEL[k] ?? k}</Button>
        ))}
      </div>
      <Button variant="text" touch onClick={() => press('clear')} disabled={!digits}>Clear</Button>

      <div id="change-due" aria-live="polite" className={cx('rounded-shape-medium px-4 py-3 text-center',
        change != null ? 'bg-success-container text-on-success-container'
          : short > 0 ? 'bg-error-container text-on-error-container' : 'bg-surface-container-highest text-on-surface-variant')}>
        {change != null ? (
          <><p className="text-title-medium">Change due</p><p className="text-display-medium tabular-nums">{formatCents(change)}</p></>
        ) : short > 0 ? (
          <><p className="text-title-medium">Not enough cash</p><p className="text-headline-medium tabular-nums">{formatCents(short)} short</p></>
        ) : (
          <p className="text-body-large py-2">Enter what the customer hands you to see the change.</p>
        )}
      </div>
    </div>
  );
}
