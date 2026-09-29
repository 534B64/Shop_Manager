import { useEffect, useState } from 'react';
import { CLIENT_BUILD, OUT_OF_DATE_MESSAGE, NEW_VERSION_MESSAGE, serverState, type HealthInfo, type ServerState } from '../lib/serverBuild';

/** Red strip when the server is older than this page (an update was installed but the
 *  server was not restarted). Checked at load, every 5 minutes, and when the tab regains focus.
 *  Renders nothing when the check fails or the versions match. */
export default function StaleServerBanner() {
  const [state, setState] = useState<ServerState>('ok');
  useEffect(() => {
    if (CLIENT_BUILD === 'dev') return undefined;
    const check = () => fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((h: HealthInfo | null) => setState(serverState(CLIENT_BUILD, h)))
      .catch(() => undefined);
    check();
    const timer = window.setInterval(check, 5 * 60_000);
    window.addEventListener('focus', check);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', check); };
  }, []);
  if (state === 'ok') return null;
  if (state === 'server-newer') {
    return (
      <div role="status" className="bg-warning-container text-on-warning-container px-4 py-2 text-title-small flex items-center gap-3">
        <span>{NEW_VERSION_MESSAGE}</span>
        <button type="button" className="underline font-medium" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
  return (
    <div role="alert" className="bg-error-container text-on-error-container px-4 py-2 text-title-small">
      {OUT_OF_DATE_MESSAGE} Some buttons may not work until you do.
    </div>
  );
}
