import { TextField } from './m3';

export interface DateRange { from: string; to: string }

/** Two native date inputs (YYYY-MM-DD); both inclusive, blank = open-ended. */
export default function DateRangeFields({ value, onChange, className }: {
  value: DateRange; onChange: (r: DateRange) => void; className?: string;
}) {
  const bad = value.from && value.to && value.from > value.to ? '“From” is after “To”' : null;
  return (
    <div className={className} role="group" aria-label="Date range">
      <div className="flex flex-wrap gap-3">
        <TextField label="From" type="date" variant="outlined" className="w-44" value={value.from} max={value.to || undefined}
          onChange={(e) => onChange({ ...value, from: e.target.value })} />
        <TextField label="To" type="date" variant="outlined" className="w-44" value={value.to} min={value.from || undefined}
          onChange={(e) => onChange({ ...value, to: e.target.value })} error={bad} />
      </div>
    </div>
  );
}

/** Local YYYY-MM-DD for today minus `days`. */
export function isoDay(daysAgo = 0): string {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
