// /customers/:id — one customer's account: profile, level, store credit,
// jobs and invoices. Every write reloads the account from the server.
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, CircularProgress, EmptyState } from '../../components/m3';
import { useQuery } from '../../lib/query';
import type { CustomerDetail as Detail } from './logic';
import ProfileCard from './ProfileCard';
import CreditCard from './CreditCard';
import JobsCard from './JobsCard';
import InvoicesCard from './InvoicesCard';
import PrintHistory from './PrintHistory';

export default function CustomerDetail() {
  const { id } = useParams();
  const valid = !!id && /^\d+$/.test(id);
  const q = useQuery<Detail>(valid ? `/api/customers/${id}` : null);
  const [printing, setPrinting] = useState(false);
  const c = q.data && String(q.data.id) === id ? q.data : undefined;

  const back = <Button variant="text" icon="chevronLeft" to="/customers">All customers</Button>;
  if (!valid || (q.error && !c)) {
    return (
      <div>
        {back}
        <EmptyState tone="error" icon="warning" title={valid ? 'Couldn’t load this customer' : 'No such customer'}
          action={valid && <Button variant="outlined" onClick={q.reload}>Try again</Button>}>
          {valid ? q.error : 'Check the link, or search the customer list.'}
        </EmptyState>
      </div>
    );
  }
  if (!c) return <div>{back}<div className="flex justify-center py-12"><CircularProgress label="Loading customer" /></div></div>;

  return (
    <div>
      <div className="mb-2 -ml-3">{back}</div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start">
        <ProfileCard customer={c} onChanged={q.reload} />
        <CreditCard customer={c} onChanged={q.reload} />
        <JobsCard jobs={c.jobs} onPrint={() => setPrinting(true)} />
        <InvoicesCard customerId={c.id} />
      </div>
      {printing && <PrintHistory customer={c} onDone={() => setPrinting(false)} />}
    </div>
  );
}
