// /pos/returns/:id — one saved return.
import { useParams } from 'react-router-dom';
import { Button, EmptyState, LinearProgress } from '../../../components/m3';
import { useQuery } from '../../../lib/query';
import PosHeader from '../PosHeader';
import type { ReturnRow } from '../types';
import ReturnResult from './ReturnResult';

export default function ReturnDetailPage() {
  const { id = '' } = useParams();
  const q = useQuery<ReturnRow>(/^\d+$/.test(id) ? `/api/returns/${id}` : null);
  return (
    <div>
      <PosHeader title={`Return #${id}`} />
      <div className="h-1 mb-2">{q.loading && <LinearProgress label="Loading the return" />}</div>
      {q.error && <EmptyState tone="error" icon="warning" title="Couldn’t load this return"
        action={<Button variant="outlined" touch onClick={q.reload}>Try again</Button>}>{q.error}</EmptyState>}
      {q.data && <ReturnResult ret={q.data} />}
    </div>
  );
}
