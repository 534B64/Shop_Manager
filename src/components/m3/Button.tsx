import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cx } from './cx';
import Icon, { type IconName } from './Icon';

export type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text' | 'elevated' | 'danger';

const VARIANT: Record<ButtonVariant, string> = {
  filled: 'bg-primary text-on-primary hover:shadow-elevation-1',
  tonal: 'bg-secondary-container text-on-secondary-container hover:shadow-elevation-1',
  outlined: 'border border-outline text-primary',
  text: 'text-primary',
  elevated: 'bg-surface-container-low text-primary shadow-elevation-1 hover:shadow-elevation-2',
  danger: 'bg-error text-on-error hover:shadow-elevation-1',
};

// Disabled per M3: on-surface at 12% (container) / 38% (content).
const DISABLED = 'disabled:bg-on-surface/12 disabled:text-on-surface/38 disabled:border-on-surface/12 disabled:shadow-none disabled:cursor-not-allowed';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: IconName;
  /** 48px tall — use on counter / POS screens (touch-target rule). */
  touch?: boolean;
  /** Render as a router link instead of a button. */
  to?: string;
  children?: ReactNode;
}

export function buttonClass(variant: ButtonVariant = 'filled', touch = false, extra?: string) {
  return cx(
    'state-layer inline-flex items-center justify-center gap-2 rounded-shape-full text-label-large whitespace-nowrap select-none transition-shadow',
    touch ? 'h-12 min-w-touch px-6' : 'h-10 px-6',
    variant === 'text' && (touch ? 'px-4' : 'px-3'),
    VARIANT[variant], DISABLED, extra,
  );
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'filled', icon, touch, to, className, children, type = 'button', ...rest }, ref,
) {
  const cls = buttonClass(variant, touch, cx(icon && 'pl-4', className));
  const body = <>{icon && <Icon name={icon} size={18} />}{children}</>;
  if (to) return <Link to={to} className={cls}>{body}</Link>;
  return <button ref={ref} type={type} className={cls} {...rest}>{body}</button>;
});
export default Button;

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  /** Accessible name — required, the button has no visible text. */
  label: string;
  variant?: 'standard' | 'filled' | 'tonal' | 'outlined';
  selected?: boolean;
  touch?: boolean;
}

const ICON_VARIANT = {
  standard: 'text-on-surface-variant',
  filled: 'bg-primary text-on-primary',
  tonal: 'bg-secondary-container text-on-secondary-container',
  outlined: 'border border-outline text-on-surface-variant',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'standard', selected, touch, className, type = 'button', ...rest }, ref,
) {
  return (
    <button ref={ref} type={type} aria-label={label} title={label} aria-pressed={selected}
      className={cx(
        'state-layer inline-flex items-center justify-center rounded-shape-full shrink-0',
        touch ? 'h-12 w-12' : 'h-10 w-10',
        selected ? 'text-primary' : ICON_VARIANT[variant], DISABLED, className,
      )} {...rest}>
      <Icon name={icon} />
    </button>
  );
});
