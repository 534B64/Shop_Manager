// /settings — my account: appearance, own PIN, server status.
import { useEffect, useState } from 'react';
import { Badge, Button, Card, CardHeader, showSnackbar } from '../../../components/m3';
import { put } from '../../../lib/api';
import { sessionUser } from '../../../lib/session';
import SettingsFrame from '../SettingsFrame';
import PinDialog from '../PinDialog';
import { ROLE_HINT, ROLE_LABEL } from '../logic';
import ThemeCard from './ThemeCard';

export default function Account() {
  const me = sessionUser();
  const [pinOpen, setPinOpen] = useState(false);
  const [health, setHealth] = useState<'checking' | 'ok' | 'down'>('checking');
  useEffect(() => {
    fetch('/api/health').then((r) => setHealth(r.ok ? 'ok' : 'down')).catch(() => setHealth('down'));
  }, []);

  return (
    <SettingsFrame title="My account">
      <div className="grid gap-4 lg:grid-cols-2 items-start max-w-5xl">
        <ThemeCard />
        <div className="grid gap-4">
          <Card>
            <CardHeader title="Sign-in" />
            {me && (
              <p className="text-body-large mb-1">Signed in as <span className="text-title-medium">{me.name}</span>{' '}
                <Badge tone="neutral" className="!h-6 px-2 align-middle">{ROLE_LABEL[me.role]}</Badge></p>
            )}
            {me && <p className="text-body-medium text-on-surface-variant mb-4">{ROLE_HINT[me.role]}</p>}
            <Button variant="tonal" onClick={() => setPinOpen(true)}>Change my PIN</Button>
          </Card>
          <Card>
            <CardHeader title="Server" />
            <p role="status" className="text-body-large">
              {health === 'checking' && <span className="text-on-surface-variant">Checking…</span>}
              {health === 'ok' && <span className="text-success">Connected</span>}
              {health === 'down' && <span className="text-error">Unreachable — check the server PC / NAS.</span>}
            </p>
          </Card>
        </div>
      </div>
      <PinDialog open={pinOpen} onClose={() => setPinOpen(false)} askCurrent title="Change my PIN" submitLabel="Change PIN"
        description="Other PCs signed in as you will be signed out."
        onSubmit={async ({ current, next }) => {
          await put('/api/users/me/pin', { current, next });
          showSnackbar('PIN changed. Other PCs signed in as you were signed out.');
        }} />
    </SettingsFrame>
  );
}
