// Clipboard helper (the old ui.* class strings are gone — use src/components/m3, ADR 0009).

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
