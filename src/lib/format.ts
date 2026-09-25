// Money is integer cents everywhere. These are the only conversion points.

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** Parse a human dollar string ("12", "$12.50", "1,200.00") to integer cents. Null if invalid. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '');
  if (cleaned === '' || !/^\d*\.?\d{0,2}$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (Number.isNaN(value)) return null;
  return Math.round(value * 100);
}

/** ISO date (yyyy-mm-dd) to local display. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  return d.toLocaleDateString();
}

/** Keep only digits, max 10. */
export function phoneDigits(input: string): string {
  return input.replace(/\D/g, '').slice(0, 10);
}

/** Auto-format as "(123) 456 - 7890" (16 chars when complete). */
export function formatPhone(input: string): string {
  const d = phoneDigits(input);
  if (d.length === 0) return '';
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)} - ${d.slice(6)}`;
}

export function isValidPhone(input: string): boolean {
  return phoneDigits(input).length === 10;
}

export function isValidEmail(input: string): boolean {
  return input.includes('@') && input.includes('.');
}
