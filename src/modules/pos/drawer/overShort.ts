import { formatCents } from '../../../lib/format';
import { overShortCents } from '../../../../shared/invoice';

export type OverShortTone = 'over' | 'short' | 'even';

/** Over/short in words (never color alone): "Over by $2.00", "Short by $0.50", "Even". */
export function describeOverShort(cents: number | null | undefined): { tone: OverShortTone; text: string; signed: string } | null {
  if (cents == null) return null;
  if (cents === 0) return { tone: 'even', text: 'Even — counted matches expected', signed: formatCents(0) };
  const abs = formatCents(Math.abs(cents));
  return cents > 0
    ? { tone: 'over', text: `Over by ${abs}`, signed: `+${abs}` }
    : { tone: 'short', text: `Short by ${abs}`, signed: `−${abs}` };
}

/** Live preview while counting: counted − expected, or null until something is counted. */
export const previewOverShort = (expectedCents: number, countedCents: number | null) =>
  countedCents == null ? null : overShortCents(expectedCents, countedCents);
