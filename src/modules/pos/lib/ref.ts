/** A fresh idempotency key (clientRef). crypto.randomUUID only exists on
 *  secure origins; a tablet on plain http to the shop server's IP falls back
 *  to getRandomValues, which works everywhere. */
export function newRef(): string {
  if (typeof crypto.randomUUID === 'function') {
    try { return crypto.randomUUID(); } catch { /* insecure context */ }
  }
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
