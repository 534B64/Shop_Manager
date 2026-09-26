// Checkbox, Switch, Chip — the selection controls.
import { useId, type InputHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';
import Icon, { type IconName } from './Icon';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
}

/** Native checkbox tinted with the primary role; the whole row (≥ 48px) is the target. */
export function Checkbox({ label, className, id, ...rest }: CheckboxProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <label htmlFor={fid} className={cx('state-layer inline-flex items-center gap-3 min-h-touch px-3 -mx-3 rounded-shape-full cursor-pointer text-body-large text-on-surface', className)}>
      <input id={fid} type="checkbox" className="h-[18px] w-[18px] accent-[rgb(var(--md-sys-color-primary-rgb))] cursor-pointer" {...rest} />
      <span>{label}</span>
    </label>
  );
}

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
}

export function Switch({ checked, onChange, label, className, disabled, ...rest }: SwitchProps) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      className={cx('inline-flex items-center gap-3 min-h-touch text-body-large text-on-surface disabled:opacity-38 group', className)} {...rest}>
      <span className={cx(
        'relative h-8 w-[52px] shrink-0 rounded-shape-full border-2 transition-colors',
        checked ? 'bg-primary border-primary' : 'bg-surface-container-highest border-outline',
      )}>
        <span className={cx(
          'state-layer absolute top-1/2 -translate-y-1/2 rounded-shape-full transition-all flex items-center justify-center',
          checked ? 'left-[22px] h-6 w-6 bg-on-primary text-primary' : 'left-[4px] h-4 w-4 bg-outline',
        )}>
          {checked && <Icon name="check" size={16} />}
        </span>
      </span>
      <span>{label}</span>
    </button>
  );
}

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** assist = action shortcut; filter = toggles a filter (shows a check when selected). */
  kind?: 'assist' | 'filter';
  selected?: boolean;
  icon?: IconName;
  touch?: boolean;
}

export function Chip({ kind = 'assist', selected, icon, touch, className, children, type = 'button', ...rest }: ChipProps) {
  const on = kind === 'filter' && selected;
  return (
    <button type={type} aria-pressed={kind === 'filter' ? !!selected : undefined}
      className={cx(
        'state-layer inline-flex items-center gap-2 rounded-shape-small px-4 text-label-large whitespace-nowrap',
        touch ? 'h-12' : 'h-8',
        on ? 'bg-secondary-container text-on-secondary-container' : 'border border-outline text-on-surface-variant',
        'disabled:opacity-38', className,
      )} {...rest}>
      {on ? <Icon name="check" size={18} /> : icon && <Icon name={icon} size={18} className="text-primary" />}
      {children}
    </button>
  );
}
