import { List, ListItem, EmptyState, Badge } from '../../components/m3';
import { useQuery } from '../../lib/query';
import DashCard from './DashCard';

interface LowItem { id: number; name: string; count: number; threshold: number }
interface Summary { lowStock: LowItem[]; lowStockCount: number }
const SHOW = 6;

export default function LowStockCard() {
  const q = useQuery<Summary>('/api/dashboard');
  const rows = q.data?.lowStock ?? [];
  const count = q.data?.lowStockCount ?? rows.length;
  return (
    <DashCard title="Low stock" to="/inventory/reorder" openLabel="Open the reorder list" loading={q.loading} error={q.error} onRetry={q.reload}
      subtitle={q.data && (count ? `${count} at or below reorder point` : undefined)}>
      {q.data && count === 0 && <EmptyState icon="check" title="Stock looks good">Nothing at or below its reorder point.</EmptyState>}
      {rows.length > 0 && (
        <List label="Low stock items" className="-mx-4 py-0">
          {rows.slice(0, SHOW).map((i) => (
            <ListItem key={i.id} to="/inventory/reorder" headline={i.name} supportingText={`Reorder at ${i.threshold}`}
              trailing={i.count <= 0
                ? <Badge tone="error" className="!h-6 px-2 text-label-medium">Out</Badge>
                : <span className="text-warning">{i.count} left</span>} />
          ))}
        </List>
      )}
      {count > SHOW && <p className="text-body-medium text-on-surface-variant mt-2">+{count - SHOW} more on the reorder list</p>}
    </DashCard>
  );
}
