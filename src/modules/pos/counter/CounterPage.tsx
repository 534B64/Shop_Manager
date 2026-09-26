// /pos — the counter sale: cart → customer → tender → Complete Sale → receipt.
import { useState } from 'react';
import { Button, Card, CardHeader, EmptyState, showSnackbar } from '../../../components/m3';
import { post } from '../../../lib/api';
import { useQuery } from '../../../lib/query';
import { formatCents } from '../../../lib/format';
import PosHeader from '../PosHeader';
import CustomerPicker from '../lib/CustomerPicker';
import { errorText, isDrawerClosed, isNetworkError } from '../lib/errors';
import OpenDrawerForm from '../drawer/OpenDrawerForm';
import type { DrawerView } from '../types';
import DrawerStatusBar from './DrawerStatusBar';
import AddItem from './AddItem';
import CartLineRow from './CartLineRow';
import PaymentMethods from './PaymentMethods';
import CashKeypad from './CashKeypad';
import Receipt, { type SaleResult } from './Receipt';
import { useSaleDraft, newDraft } from './useSaleDraft';
import { digitsToCents } from './keypad';
import * as C from './cart';

export default function CounterPage() {
  const drawerQ = useQuery<{ drawer: DrawerView | null }>('/api/drawer/current');
  const taxQ = useQuery<{ ratePct: number }>('/api/settings/tax');
  const [draft, setDraft] = useSaleDraft();
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<SaleResult | null>(null);

  const drawer = drawerQ.data?.drawer;
  const rate = taxQ.data?.ratePct ?? 0;
  const totals = C.cartTotals(draft.cart, rate);
  const problems = C.cartProblems(draft.cart, totals.totalCents);
  const cash = draft.method === 'cash';
  const tendered = digitsToCents(draft.tendered);
  const needDrawer = cash && drawerQ.data != null && !drawer;
  const cashShort = cash && tendered > 0 && tendered < totals.totalCents;

  const edit = (f: (c: C.CartLine[]) => C.CartLine[]) => setDraft((d) => ({ ...d, cart: f(d.cart) }));
  const addLine = (f: (c: C.CartLine[]) => C.CartLine[]) => edit((c) => {
    const next = f(c);
    const added = next.find((l) => !c.some((o) => o.key === l.key));
    setLastAdded(added?.key ?? null);
    return next;
  });

  async function complete() {
    if (busy || problems.length || !draft.method || cashShort || needDrawer || !taxQ.data) return;
    setBusy(true); setError(null);
    try {
      const res = await post<SaleResult>('/api/pos/sale', {
        clientRef: draft.clientRef, method: draft.method, lines: C.toSaleLines(draft.cart),
        ...(draft.customer ? { customerId: draft.customer.id } : {}),
        ...(cash && tendered > 0 ? { tenderedCents: tendered } : {}),
      });
      setReceipt(res);
      setDraft(newDraft());
      drawerQ.reload();
    } catch (e) {
      if (isDrawerClosed(e)) { drawerQ.reload(); setError('The cash drawer is closed. Open it below (count the float), then complete the sale.'); }
      else if (isNetworkError(e)) setError('No answer from the server — check the wifi and tap Complete Sale again. It won’t charge twice.');
      else setError(errorText(e));
    } finally { setBusy(false); }
  }

  if (receipt) {
    return (
      <div>
        <PosHeader title="Counter sale" />
        <Receipt sale={receipt} onNewSale={() => setReceipt(null)} />
      </div>
    );
  }

  const blocked = problems[0] ?? (!draft.method ? 'Pick how the customer pays.' : cashShort ? 'Cash tendered is less than the total.' : needDrawer ? 'Open the cash drawer first (below).' : null);

  return (
    <div>
      <PosHeader title="Counter sale" action={draft.cart.length > 0 && (
        <Button variant="text" touch onClick={() => { setDraft(newDraft()); showSnackbar('Sale cleared'); }}>Clear sale</Button>)} />
      <DrawerStatusBar drawer={drawer} loading={drawerQ.loading} error={drawerQ.error} onRetry={drawerQ.reload} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px] items-start">
        <Card variant="outlined" aria-labelledby="cart-title">
          <CardHeader id="cart-title" title="Items" subtitle={draft.cart.length ? `${draft.cart.length} line${draft.cart.length === 1 ? '' : 's'}` : undefined} />
          <AddItem onStock={(it) => addLine((c) => C.addStockLine(c, it, false))}
            onCustom={(d) => addLine((c) => C.addFreeLine(c, d, null, false))} />
          {draft.cart.length === 0
            ? <EmptyState icon="cart" title="No items yet">Search stock above, or type what you’re selling and add it as a custom item.</EmptyState>
            : (
              <ul aria-label="Items in this sale" className="mt-2">
                {draft.cart.map((l, i) => (
                  <CartLineRow key={l.key} line={l} priced={totals.lines[i]} autoFocusPrice={l.key === lastAdded && l.unitPriceCents == null}
                    onQty={(n) => edit((c) => C.setQty(c, l.key, n))} onPrice={(p) => edit((c) => C.setPrice(c, l.key, p))}
                    onTaxable={(t) => edit((c) => C.setTaxable(c, l.key, t))} onDescription={(d) => edit((c) => C.setDescription(c, l.key, d))}
                    onRemove={() => edit((c) => C.removeLine(c, l.key))} />
                ))}
              </ul>
            )}
        </Card>

        <Card variant="outlined" aria-labelledby="pay-title" className="flex flex-col gap-4 lg:sticky lg:top-20">
          <CustomerPicker value={draft.customer} onChange={(customer) => setDraft((d) => ({ ...d, customer }))} />

          <dl className="grid grid-cols-2 gap-y-1 text-body-large tabular-nums" aria-label="Totals">
            <dt className="text-on-surface-variant">Subtotal</dt><dd className="text-right">{formatCents(totals.subtotalCents)}</dd>
            <dt className="text-on-surface-variant">Tax{taxQ.data ? ` (${rate}% on taxed lines)` : ''}</dt><dd className="text-right">{formatCents(totals.taxCents)}</dd>
            <dt id="pay-title" className="text-headline-small">Total</dt>
            <dd className="text-right text-display-small" aria-live="polite">{formatCents(totals.totalCents)}</dd>
          </dl>
          {taxQ.error && <p role="alert" className="text-body-medium text-error">Couldn’t load the tax rate: {taxQ.error}</p>}

          <PaymentMethods value={draft.method} onChange={(method) => setDraft((d) => ({ ...d, method }))} />
          {needDrawer && (
            <div className="rounded-shape-medium bg-warning-container text-on-warning-container p-4">
              <p className="text-title-medium mb-3">The cash drawer is closed. Count the starting cash to open it:</p>
              <div className="rounded-shape-small bg-surface p-3"><OpenDrawerForm compact onOpened={() => { setError(null); drawerQ.reload(); }} /></div>
            </div>
          )}
          {cash && !needDrawer && <CashKeypad totalCents={totals.totalCents} digits={draft.tendered}
            onDigits={(tendered) => setDraft((d) => ({ ...d, tendered }))} />}

          {error && <p role="alert" className="rounded-shape-small bg-error-container text-on-error-container px-4 py-3 text-body-large">{error}</p>}
          <Button touch className="!h-16 !text-title-large w-full" disabled={busy || !!blocked || !taxQ.data} onClick={complete}>
            {busy ? 'Completing…' : `Complete sale · ${formatCents(totals.totalCents)}`}
          </Button>
          {blocked && !busy && <p className="text-body-medium text-on-surface-variant -mt-2 text-center">{blocked}</p>}
        </Card>
      </div>
    </div>
  );
}
