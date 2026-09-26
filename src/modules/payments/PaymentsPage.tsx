// /payments — take payments on jobs with a balance, refunds and voids, daily
// totals and CSV exports. Record-only: card/check are handled outside the system.
import { useEffect, useState } from 'react';
import { Button, TextField } from '../../components/m3';
import type { PaymentRow } from '../pos/types';
import type { Balance } from './logic';
import OwedList from './OwedList';
import RecentPayments from './RecentPayments';
import RecordPaymentDialog from './RecordPaymentDialog';
import { RefundDialog, VoidPaymentDialog } from './PaymentActionDialogs';
import { TodayCard, ReportsCard } from './SummaryCards';

export default function PaymentsPage() {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 250); return () => clearTimeout(t); }, [text]);
  const [version, setVersion] = useState(0);
  const [paying, setPaying] = useState<Balance | null>(null);
  const [refunding, setRefunding] = useState<PaymentRow | null>(null);
  const [voiding, setVoiding] = useState<PaymentRow | null>(null);
  const done = () => { setPaying(null); setRefunding(null); setVoiding(null); setVersion((v) => v + 1); };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-headline-medium">Payments</h1>
          <p className="text-body-medium text-on-surface-variant">Record-only — cash, checks and cards are handled outside the system. Every payment and refund needs the drawer open.</p>
        </div>
        <Button variant="outlined" touch to="/pos">Counter sale</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr] mb-6">
        <TodayCard version={version} />
        <ReportsCard version={version} />
      </div>

      <TextField label="Search owed and payments by customer or job" leadingIcon="search" className="max-w-xl mb-4"
        value={text} onChange={(e) => setText(e.target.value)} />

      <h2 className="text-title-large mb-2">Owed</h2>
      <OwedList q={q} version={version} onPay={setPaying} />

      <h2 className="text-title-large mt-8 mb-2">Recent payments</h2>
      <RecentPayments q={q} version={version} onRefund={setRefunding} onVoid={setVoiding} />

      {paying && <RecordPaymentDialog job={paying} onClose={() => setPaying(null)} onDone={done} />}
      {refunding && <RefundDialog p={refunding} onClose={() => setRefunding(null)} onDone={done} />}
      {voiding && <VoidPaymentDialog p={voiding} onClose={() => setVoiding(null)} onDone={done} />}
    </div>
  );
}
