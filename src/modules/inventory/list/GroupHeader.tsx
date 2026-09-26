import { Icon } from '../../../components/m3';

export interface GroupCount { key: string; label: string; count: number; low: number }

/** A group's header row in the item list: tap to collapse / re-open (48px, full width). */
export default function GroupHeader({ label, closed, counts, onToggle }: {
  label: string; closed: boolean; counts?: GroupCount; onToggle: () => void;
}) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={!closed}
      aria-label={`${label}${counts ? `, ${counts.count} item${counts.count === 1 ? '' : 's'}` : ''}`}
      className="state-layer w-full min-h-12 flex items-center gap-2 px-4 text-left text-on-surface">
      <Icon name={closed ? 'chevronRight' : 'dropDown'} />
      <span className="text-title-small flex-1">{label}</span>
      {counts && (
        <span className="text-label-medium text-on-surface-variant tabular-nums">
          {counts.count} item{counts.count === 1 ? '' : 's'}
        </span>
      )}
      {counts && counts.low > 0 && (
        <span className="text-label-medium px-2 py-0.5 rounded-shape-full bg-warning text-on-warning">LOW {counts.low}</span>
      )}
    </button>
  );
}
