// Sale-level "Tax exempt" switch (owner decision D10): counter sales are taxed
// unless this is on, and then the server needs a short reason, which is kept
// on the invoice and in the audit log. Used on /pos (the only counter-sale
// screen — Quick Order was retired into it, D15).
import { Chip, Switch, TextField } from '../../../components/m3';
import { TAX_EXEMPT_REASONS, TAX_EXEMPT_REASON_MAX, taxExemptReason } from '../../../../shared/invoice';
import type { TaxExemption } from '../counter/cart';

export default function TaxExemptField({ value, onChange }: { value: TaxExemption; onChange: (x: TaxExemption) => void }) {
  const missing = value.on && !taxExemptReason(value.reason);
  return (
    <div className="flex flex-col gap-2">
      <Switch checked={value.on} label="Tax exempt" onChange={(on) => onChange({ ...value, on })} />
      {value.on && (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Common exemption reasons">
            {TAX_EXEMPT_REASONS.map((r) => (
              <Chip key={r} kind="filter" touch selected={value.reason.trim() === r} onClick={() => onChange({ ...value, reason: r })}>{r}</Chip>
            ))}
          </div>
          <TextField label="Why is it tax exempt? *" value={value.reason} maxLength={TAX_EXEMPT_REASON_MAX} autoComplete="off"
            onChange={(e) => onChange({ ...value, reason: e.target.value })}
            error={missing && value.reason.trim() ? 'A few words, e.g. resale certificate' : null}
            supportingText="Kept on the invoice and in the audit log." />
        </>
      )}
    </div>
  );
}
