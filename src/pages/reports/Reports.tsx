// /reports — one place for the numbers the shop already records: payments
// summary, sales & tax from invoices, CSV exports, drawer Z-reports, and
// inventory value. No new report formats (CPA requirements TBD).
import { useSearchParams } from 'react-router-dom';
import DateRangeFields, { type DateRange } from '../../components/DateRangeFields';
import { monthToDate } from './logic';
import PaymentsCard from './PaymentsCard';
import SalesCard from './SalesCard';
import ExportsCard from './ExportsCard';
import DrawerCard from './DrawerCard';
import ValuationCard from './ValuationCard';

export default function Reports() {
  const [sp, setSp] = useSearchParams();
  const def = monthToDate();
  const range: DateRange = { from: sp.get('from') ?? def.from, to: sp.get('to') ?? def.to };
  const bad = !!(range.from && range.to && range.from > range.to);
  const setRange = (r: DateRange) => setSp({ from: r.from, to: r.to }, { replace: true });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-headline-medium">Reports</h1>
          <p className="text-body-medium text-on-surface-variant max-w-3xl">
            Totals and exports from what the shop already recorded. Dates are inclusive; leave one blank for “since the start” or “through today”.
          </p>
        </div>
        <DateRangeFields value={range} onChange={setRange} />
      </div>
      {bad ? <p role="alert" className="text-error text-body-large">Pick a “From” date on or before the “To” date.</p> : (
        <div className="grid gap-4 lg:grid-cols-2 items-start">
          <PaymentsCard range={range} />
          <SalesCard range={range} />
          <ExportsCard range={range} />
          <ValuationCard />
          <DrawerCard />
        </div>
      )}
    </div>
  );
}
