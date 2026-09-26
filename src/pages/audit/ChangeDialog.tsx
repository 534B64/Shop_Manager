import { Button, Dialog } from '../../components/m3';
import { changedKeys, prettyJson, when, type AuditRow } from './logic';

/** Before / after snapshots of one change, as plain text (never HTML). */
export default function ChangeDialog({ row, onClose, who }: { row: AuditRow | null; onClose: () => void; who?: string }) {
  const changed = row ? changedKeys(row.beforeJson, row.afterJson) : [];
  const pre = 'max-h-80 overflow-auto rounded-shape-small bg-surface-container-highest text-on-surface p-3 font-mono text-body-small whitespace-pre-wrap break-all';
  return (
    <Dialog open={!!row} onClose={onClose} className="max-w-4xl" title={row ? `${row.action} · ${row.entity}${row.entityId ? ` #${row.entityId}` : ''}` : ''}
      description={row ? `${when(row.at)} · ${row.userId == null ? 'System' : who ?? `User ${row.userId}`}${row.approvalId ? ` · approval #${row.approvalId}` : ''}` : undefined}
      actions={<Button variant="text" onClick={onClose}>Close</Button>}>
      {row && <>
        <p className="text-body-medium mb-3">
          {changed.length ? <>Changed: <span className="font-mono">{changed.join(', ')}</span></> : 'No field differences recorded.'}
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <section aria-label="Before"><h3 className="text-title-small mb-1">Before</h3><pre className={pre}>{prettyJson(row.beforeJson)}</pre></section>
          <section aria-label="After"><h3 className="text-title-small mb-1">After</h3><pre className={pre}>{prettyJson(row.afterJson)}</pre></section>
        </div>
        {row.requestId && <p className="mt-3 text-body-small text-on-surface-variant">Request {row.requestId}</p>}
      </>}
    </Dialog>
  );
}
