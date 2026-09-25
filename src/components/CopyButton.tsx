import { useState } from 'react';
import { copyToClipboard } from '../lib/ui';

/**
 * One-tap copy (Phase 9, file-by-PO). The shop names design files after the PO
 * in SignLab, so the quickest workflow is: copy the PO here, paste as the
 * filename. No uploads, no storage — it just matches the existing habit.
 */
export default function CopyButton({ text, label = 'Copy', className = '' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        if (await copyToClipboard(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        }
      }}
      title={`Copy "${text}"`}
      className={`px-3 py-2 border border-line rounded-token text-sm hover:bg-bg ${className}`}
    >
      {done ? 'Copied ✓' : label}
    </button>
  );
}
