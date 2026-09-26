// One-tap copy of the PO — the shop names the SignLab file after it.
import { useState } from 'react';
import { Button } from '../../../components/m3';
import { copyToClipboard } from '../../../lib/ui';

export default function CopyPo({ po, className }: { po: string | null; className?: string }) {
  const [done, setDone] = useState(false);
  if (!po) return null;
  return (
    <Button variant="outlined" icon={done ? 'check' : undefined} className={className} title={`Copy PO ${po}`}
      onClick={async (e) => {
        e.stopPropagation();
        if (await copyToClipboard(po)) { setDone(true); setTimeout(() => setDone(false), 1200); }
      }}>
      {done ? 'Copied' : 'Copy PO'}
    </Button>
  );
}
