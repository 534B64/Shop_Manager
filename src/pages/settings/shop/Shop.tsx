// /settings/shop (admin) — tax, level discounts, POS refund approval limit,
// inventory knobs, and which dataset this server runs on.
import SettingsFrame from '../SettingsFrame';
import SettingsCard from './SettingsCard';
import DataCard from './DataCard';

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);

export default function Shop() {
  return (
    <SettingsFrame title="Shop" min="admin"
      subtitle="Changes apply to new quotes and sales right away; saved invoices never change.">
      <div className="grid gap-4 lg:grid-cols-2 items-start max-w-5xl">
        <SettingsCard title="Sales tax" url="/api/settings/tax"
          subtitle="Applied to taxable lines at the moment of sale."
          fields={[{ key: 'ratePct', label: 'Tax rate', suffix: '%', min: 0, max: 30 }]}
          pick={(d) => ({ ratePct: num(d.ratePct) })} />
        <SettingsCard title="Customer level discounts" url="/api/settings/levels"
          subtitle="Level 0 gets no discount. Level discounts apply after tax. A manager sets a customer’s level."
          fields={['1', '2', '3'].map((l) => ({ key: l, label: `Level ${l} discount`, suffix: '%', min: 0, max: 100 }))}
          pick={(d) => ({ 1: num(d['1']), 2: num(d['2']), 3: num(d['3']) })} />
        <SettingsCard title="POS refunds" url="/api/settings/pos"
          subtitle="A return refunding more than this needs a manager’s approval."
          fields={[{ key: 'refundApprovalThresholdCents', label: 'Refund approval limit', suffix: '$', min: 0, max: 100000,
            show: (c) => (c / 100).toFixed(2), send: (d) => Math.round(d * 100) }]}
          pick={(d) => ({ refundApprovalThresholdCents: num(d.refundApprovalThresholdCents) })} />
        <SettingsCard title="Inventory" url="/api/settings/inventory"
          subtitle="A cycle-count variance needs a reason when it beats either threshold. Buffer days pad the automatic reorder point (usage per day × lead time + buffer)."
          fields={[
            { key: 'pctThreshold', label: 'Variance threshold', suffix: '%', min: 0, max: 100 },
            { key: 'unitThreshold', label: 'Variance threshold', suffix: 'units', min: 0, max: 100000 },
            { key: 'reorderBufferDays', label: 'Reorder buffer', suffix: 'days', min: 0, max: 60 },
          ]}
          pick={(d) => ({ pctThreshold: num(d.pctThreshold), unitThreshold: num(d.unitThreshold), reorderBufferDays: num(d.reorderBufferDays) })} />
        <DataCard />
      </div>
    </SettingsFrame>
  );
}
