// /audit (admin) — the audit log (every recorded change) and the approvals
// list (who approved what). The view and filters live in the URL.
import { useSearchParams } from 'react-router-dom';
import { Tabs } from '../../components/m3';
import { useQuery } from '../../lib/query';
import AuditLog from './AuditLog';
import Approvals from './Approvals';

export interface UserName { id: number; name: string }

export default function Audit() {
  const [sp, setSp] = useSearchParams();
  const view = sp.get('view') === 'approvals' ? 'approvals' : 'log';
  const users = useQuery<UserName[]>('/api/users?all=1');
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    setSp(next, { replace: true });
  };
  const names = new Map((users.data ?? []).map((u) => [u.id, u.name]));

  return (
    <div>
      <h1 className="text-headline-medium">Audit</h1>
      <p className="text-body-medium text-on-surface-variant max-w-3xl">
        Every change is recorded with who made it and what it looked like before and after. Nothing here can be edited or removed.
      </p>
      <Tabs label="Audit views" className="mt-2 mb-4" value={view}
        onChange={(v) => { const n = new URLSearchParams(); if (v === 'approvals') n.set('view', v); setSp(n, { replace: true }); }}
        items={[{ value: 'log', label: 'Change log' }, { value: 'approvals', label: 'Approvals' }]} />
      <div role="tabpanel">
        {view === 'log'
          ? <AuditLog params={sp} set={set} users={users.data ?? []} names={names} />
          : <Approvals params={sp} set={set} users={users.data ?? []} />}
      </div>
    </div>
  );
}
