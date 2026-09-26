import { Icon, cx } from '../../../components/m3';
import { describeOverShort } from './overShort';

/** Over/short with sign, icon, words and color. `large` for the close screen. */
export default function OverShortBadge({ cents, label, large }: { cents: number | null | undefined; label?: string; large?: boolean }) {
  const d = describeOverShort(cents);
  if (!d) return <span className="text-on-surface-variant">—</span>;
  const cls = d.tone === 'even' ? 'bg-surface-container-highest text-on-surface'
    : d.tone === 'over' ? 'bg-warning-container text-on-warning-container' : 'bg-error-container text-on-error-container';
  return (
    <span className={cx('inline-flex items-center gap-2 rounded-shape-small px-3', large ? 'py-2 text-title-large' : 'py-1 text-label-large', cls)}>
      <Icon name={d.tone === 'even' ? 'check' : 'warning'} size={large ? 24 : 18} />
      <span>{label ? `${label}: ` : ''}{d.text}</span>
      <span className="tabular-nums">({d.signed})</span>
    </span>
  );
}
