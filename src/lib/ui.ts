// Shared design-system primitives (Phase 9). One place for the look so every
// screen inherits it instead of re-deriving button/input/card classes. Built on
// the existing CSS-variable tokens (--accent, --line, --surface, etc.) and the
// light / dark / high-contrast (minimal) themes — these are class strings, not new colors.
//
// Adoption is incremental: new/updated UI should import from here; existing
// pages can migrate a row at a time without a risky big-bang reskin.

/** Inputs & selects — consistent height, border, radius, and focus affordance. */
export const ui = {
  input: 'px-3 py-2.5 bg-bg border border-line rounded-token text-base w-full',
  inputSm: 'px-2 py-1.5 bg-bg border border-line rounded-token text-sm',

  // Buttons. Primary = accent; subtle = outline; danger = destructive outline.
  btnPrimary: 'px-4 py-2.5 bg-accent text-accent-contrast rounded-token font-semibold disabled:opacity-50',
  btn: 'px-4 py-2.5 border border-line rounded-token hover:bg-bg disabled:opacity-50',
  btnSm: 'px-3 py-1.5 text-sm border border-line rounded-token hover:bg-bg',
  btnDanger: 'px-3 py-1.5 text-sm border border-line rounded-token text-danger hover:bg-bg',

  card: 'bg-surface border border-line rounded-token p-4',
  chip: 'text-xs px-2 py-0.5 rounded-token border border-line text-muted',
  label: 'block text-sm text-muted mb-1',
} as const;

/**
 * Copy text to the clipboard. Uses the async Clipboard API when available
 * (modern browsers over the LAN's http origin still allow it on localhost; on
 * plain http to an IP it may not, so fall back to a hidden textarea + execCommand).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
