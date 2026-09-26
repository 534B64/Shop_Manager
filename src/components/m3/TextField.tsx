import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cx } from './cx';
import Icon, { type IconName } from './Icon';

type FieldVariant = 'filled' | 'outlined';

interface FrameProps {
  id: string; label: string; variant: FieldVariant; supportingText?: ReactNode; error?: string | null;
  leadingIcon?: IconName; className?: string; children: ReactNode; trailing?: ReactNode;
}

/** Container + label + supporting/error text shared by TextField and Select.
 *  The label always sits at the top of the container (M3 "populated" layout),
 *  so it never overlaps a value and needs no animation. */
function FieldFrame({ id, label, variant, supportingText, error, leadingIcon, className, children, trailing }: FrameProps) {
  const bad = !!error;
  return (
    <div className={cx('min-w-0', className)}>
      <div className={cx(
        'group relative flex items-center min-h-14 px-4 gap-3 transition-colors',
        variant === 'filled'
          ? 'bg-surface-container-highest rounded-t-shape-extra-small border-b focus-within:border-b-2'
          : 'rounded-shape-extra-small border focus-within:border-2',
        bad ? 'border-error' : variant === 'filled' ? 'border-on-surface-variant focus-within:border-primary' : 'border-outline focus-within:border-primary',
      )}>
        {leadingIcon && <Icon name={leadingIcon} className="text-on-surface-variant shrink-0" />}
        <div className="flex-1 min-w-0 pt-5 pb-1.5">
          <label htmlFor={id} className={cx(
            'absolute top-1.5 text-body-small truncate max-w-[calc(100%-2rem)]',
            bad ? 'text-error' : 'text-on-surface-variant group-focus-within:text-primary',
          )}>{label}</label>
          {children}
        </div>
        {trailing}
      </div>
      {(error || supportingText) && (
        <p id={`${id}-support`} className={cx('px-4 pt-1 text-body-small', bad ? 'text-error' : 'text-on-surface-variant')}>
          {error || supportingText}
        </p>
      )}
    </div>
  );
}

const inputCls = 'w-full bg-transparent text-body-large text-on-surface placeholder:text-on-surface-variant/70 outline-none focus-visible:outline-none disabled:text-on-surface/38';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string;
  variant?: FieldVariant;
  supportingText?: ReactNode;
  error?: string | null;
  leadingIcon?: IconName;
  trailing?: ReactNode;
}

const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, variant = 'filled', supportingText, error, leadingIcon, trailing, className, id, ...rest }, ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldFrame id={fid} label={label} variant={variant} supportingText={supportingText} error={error}
      leadingIcon={leadingIcon} className={className} trailing={trailing}>
      <input ref={ref} id={fid} className={inputCls} aria-invalid={error ? true : undefined}
        aria-describedby={error || supportingText ? `${fid}-support` : undefined} {...rest} />
    </FieldFrame>
  );
});
export default TextField;

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  variant?: FieldVariant;
  supportingText?: ReactNode;
  error?: string | null;
}

/** Native <select> in the M3 field frame (keyboard + mobile pickers for free). */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, variant = 'filled', supportingText, error, className, id, children, ...rest }, ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldFrame id={fid} label={label} variant={variant} supportingText={supportingText} error={error} className={className}
      trailing={<Icon name="dropDown" className="text-on-surface-variant pointer-events-none shrink-0" />}>
      <select ref={ref} id={fid} className={cx(inputCls, 'appearance-none cursor-pointer')}
        aria-invalid={error ? true : undefined} aria-describedby={error || supportingText ? `${fid}-support` : undefined} {...rest}>
        {children}
      </select>
    </FieldFrame>
  );
});
