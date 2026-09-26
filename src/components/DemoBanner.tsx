import { useEffect, useState } from 'react';

/** "DEMO DATA" strip, shown only when the server's database is labeled demo
 *  (GET /api/health → dataset, ADR 0008). Renders nothing otherwise — including
 *  when the check fails, so a flaky network never shows a false banner. */
export default function DemoBanner() {
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((h: { dataset?: string | null } | null) => setDemo(h?.dataset === 'demo'))
      .catch(() => undefined);
  }, []);
  if (!demo) return null;
  return (
    <div role="status" className="bg-warning-container text-on-warning-container rounded-shape-small px-4 py-2 mb-4 text-title-small">
      DEMO DATA — practice database. Nothing here is real; don't ring up real sales.
    </div>
  );
}
