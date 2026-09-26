import type { ReactNode } from 'react';
import { formatCents } from '../../../lib/format';
import type { ZReport } from '../../../../shared/invoice';
import { methodLabel } from '../types';
import OverShortBadge from './OverShortBadge';

const Row = ({ k, v, strong }: { k: ReactNode; v: ReactNode; strong?: boolean }) => (
  <>
    <dt className={strong ? 'text-title-medium' : 'text-on-surface-variant'}>{k}</dt>
    <dd className={`text-right tabular-nums ${strong ? 'text-title-medium' : ''}`}>{v}</dd>
  </>
);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-shape-medium border border-outline-variant p-4">
      <h3 className="text-title-medium mb-2">{title}</h3>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-body-large">{children}</dl>
    </section>
  );
}

/** A Z-report (frozen at close, or the live preview while the drawer is open). */
export default function ZReportView({ z }: { z: ZReport }) {
  const methods = Object.entries(z.byMethod);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Section title="Cash">
        <Row k="Opening float" v={formatCents(z.openingFloatCents)} />
        <Row k="Cash in − out" v={formatCents(z.byMethod.cash?.netCents ?? 0)} />
        <Row k="Expected in drawer" v={formatCents(z.cash.expectedCents)} strong />
        {z.cash.countedCents != null && <Row k="Counted" v={formatCents(z.cash.countedCents)} strong />}
        {z.cash.overShortCents != null && <div className="col-span-2 mt-1"><OverShortBadge cents={z.cash.overShortCents} label="Cash" /></div>}
      </Section>
      <Section title="Checks">
        <Row k="Expected" v={formatCents(z.checks.expectedCents)} strong />
        {z.checks.countedCents != null && <Row k="Counted" v={formatCents(z.checks.countedCents)} strong />}
        {z.checks.overShortCents != null && <div className="col-span-2 mt-1"><OverShortBadge cents={z.checks.overShortCents} label="Checks" /></div>}
      </Section>

      <section className="rounded-shape-medium border border-outline-variant p-4 md:col-span-2 overflow-x-auto">
        <h3 className="text-title-medium mb-2">By tender</h3>
        {methods.length === 0 ? <p className="text-body-medium text-on-surface-variant">No payments in this session yet.</p> : (
          <table className="w-full text-body-large tabular-nums">
            <caption className="sr-only">Totals by tender</caption>
            <thead><tr className="text-title-small text-on-surface-variant text-right">
              <th scope="col" className="text-left py-1">Tender</th><th scope="col">Count</th><th scope="col">In</th><th scope="col">Refunds</th><th scope="col">Net</th>
            </tr></thead>
            <tbody>
              {methods.map(([m, t]) => (
                <tr key={m} className="text-right border-t border-outline-variant">
                  <th scope="row" className="text-left py-1 font-normal">{methodLabel(m)}</th>
                  <td>{t.count}</td><td>{formatCents(t.paymentsCents)}</td><td>{formatCents(t.refundsCents)}</td><td>{formatCents(t.netCents)}</td>
                </tr>
              ))}
              <tr className="text-right border-t border-outline-variant text-title-medium">
                <th scope="row" className="text-left py-1">Total</th><td />
                <td>{formatCents(z.paymentsCents)}</td><td>{formatCents(z.refundsCents)}</td><td>{formatCents(z.paymentsCents - z.refundsCents)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </section>

      <Section title="Sales">
        <Row k="Invoices" v={z.sales.invoiceCount ? `${z.sales.invoiceCount} (${z.sales.firstNumber}–${z.sales.lastNumber})` : '0'} />
        <Row k="Subtotal" v={formatCents(z.sales.subtotalCents)} />
        <Row k="Tax" v={formatCents(z.sales.taxCents)} />
        <Row k="Discounts" v={formatCents(z.sales.discountCents)} />
        <Row k="Total" v={formatCents(z.sales.totalCents)} strong />
      </Section>
      <Section title="Voids, returns, net">
        <Row k={`Voids (${z.voids.count})`} v={`−${formatCents(z.voids.totalCents)}`} />
        <Row k={`Returns (${z.returns.count})`} v={`−${formatCents(z.returns.totalCents)}`} />
        <Row k="Net sales" v={formatCents(z.netSalesCents)} strong />
        <Row k="Net tax" v={formatCents(z.netTaxCents)} />
        <Row k={`Voided payments (${z.voidedPayments.count})`} v={formatCents(z.voidedPayments.cents)} />
      </Section>
    </div>
  );
}
