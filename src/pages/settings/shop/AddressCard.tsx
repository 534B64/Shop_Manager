import { useEffect, useState } from 'react';
import { Card, CardHeader } from '../../../components/m3';

/** "Open on other devices": the addresses to type on a phone or another PC (GET /api/health). */
export default function AddressCard() {
  const [addresses, setAddresses] = useState<string[] | null | undefined>();
  useEffect(() => {
    fetch('/api/health').then((r) => (r.ok ? r.json() : null))
      .then((h: { addresses?: string[] } | null) => setAddresses(h ? h.addresses ?? [] : null))
      .catch(() => setAddresses(null));
  }, []);
  const [friendly, ...fallback] = addresses ?? [];
  return (
    <Card>
      <CardHeader title="Open on other devices" subtitle="Type this in the browser on another PC or a phone on the shop wifi." />
      {addresses === undefined && <p className="text-body-medium text-on-surface-variant" role="status">checking…</p>}
      {addresses === null && <p className="text-body-medium text-error" role="alert">Couldn’t reach the server to check.</p>}
      {addresses && addresses.length === 0 && (
        <p className="text-body-medium text-on-surface-variant">
          No address to show yet. Run Setup.bat on the shop PC to choose a name for the shop.
        </p>
      )}
      {friendly && (
        <>
          <p className="text-headline-small font-mono break-all" data-testid="address-main">{friendly.replace(/^http:\/\//, '')}</p>
          {fallback.length > 0 && (
            <p className="text-body-medium text-on-surface-variant mt-3">
              If a device can’t open that (some Android phones can’t), use{' '}
              {fallback.map((a, i) => (
                <span key={a}>{i > 0 && ' or '}<span className="font-mono text-on-surface">{a.replace(/^http:\/\//, '')}</span></span>
              ))}.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
