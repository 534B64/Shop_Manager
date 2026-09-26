// Shown on an invoiced job: the money is fixed; corrections go through the invoice (ADR 0007).
import { Link } from 'react-router-dom';
import { Icon } from '../../../components/m3';

export default function InvoiceBanner({ number }: { number: string }) {
  return (
    <div role="note" className="flex items-start gap-3 rounded-shape-medium bg-secondary-container text-on-secondary-container p-4 mb-4">
      <Icon name="info" className="shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-title-small">Invoiced — #{number}</p>
        <p className="text-body-medium">
          Price, tax, discount, customer and lines are locked. To correct them, void the invoice or take a return.
          Title, due date, tags, notes and the file reference can still change.
        </p>
        <Link to={`/pos/invoices/${number}`} className="text-label-large underline">Open invoice #{number}</Link>
      </div>
    </div>
  );
}
