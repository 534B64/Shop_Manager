// Pick an existing customer, or type a new one (phone + email required — only Walk-in is exempt).
import { useRef } from 'react';
import { Button, TextField } from '../../../components/m3';
import { formatPhone } from '../../../lib/format';
import CustomerSearch from '../shared/CustomerSearch';
import { emptyCustomer, type CustomerDraft } from './draft';

interface Props { customer: CustomerDraft; locked: boolean; autoFocus?: boolean; onChange: (c: CustomerDraft) => void; onPicked?: () => void }

export default function CustomerField({ customer, locked, autoFocus, onChange, onPicked }: Props) {
  const search = useRef<HTMLInputElement>(null);
  if (customer.id) {
    return (
      <div className="flex items-center gap-3 min-h-14 px-4 rounded-shape-extra-small bg-surface-container-highest">
        <div className="flex-1 min-w-0">
          <p className="text-body-small text-on-surface-variant">Customer</p>
          <p className="text-body-large truncate">
            {customer.name}
            <span className="text-on-surface-variant">{customer.phone ? ` · ${customer.phone}` : ''}{customer.level > 0 ? ` · Level ${customer.level}` : ''}</span>
          </p>
        </div>
        {!locked && (
          <Button variant="text" onClick={() => { onChange(emptyCustomer()); setTimeout(() => search.current?.focus(), 0); }}>Change</Button>
        )}
      </div>
    );
  }
  const isNew = customer.name.trim().length > 0;
  return (
    <div className="flex flex-col gap-2">
      <CustomerSearch ref={search} value={customer.name} picked={false} autoFocus={autoFocus} disabled={locked}
        label="Customer * (name or phone)"
        supportingText={isNew ? 'No match picked — this makes a new customer.' : undefined}
        onText={(name) => onChange({ ...emptyCustomer(), name, phone: customer.phone, email: customer.email })}
        onPick={(c) => { onChange({ id: c.id, name: c.name, phone: c.phone ?? '', email: c.email ?? '', level: c.level ?? 0 }); setTimeout(() => onPicked?.(), 0); }} />
      {isNew && (
        <div className="grid gap-2 sm:grid-cols-2">
          <TextField label="Phone *" inputMode="tel" maxLength={16} value={customer.phone} placeholder="(123) 456 - 7890"
            autoComplete="off" onChange={(e) => onChange({ ...customer, phone: formatPhone(e.target.value) })} />
          <TextField label="Email *" type="email" inputMode="email" maxLength={120} value={customer.email} placeholder="name@example.com"
            autoComplete="off" onChange={(e) => onChange({ ...customer, email: e.target.value })} />
        </div>
      )}
    </div>
  );
}
