import { IconButton } from '../../../components/m3';
import type { KeysetState } from './keyset';

/** Prev / next for a keyset list (no total — the server doesn't count). */
export default function KeysetPager({ state }: { state: KeysetState<unknown> }) {
  if (!state.hasPrev && !state.hasNext) return null;
  return (
    <div className="flex items-center justify-end gap-2 px-2 h-14 text-body-medium text-on-surface-variant">
      <span aria-live="polite" className="px-2">Page {state.page}</span>
      <IconButton icon="chevronLeft" label="Newer" disabled={!state.hasPrev} onClick={state.prev} touch />
      <IconButton icon="chevronRight" label="Older" disabled={!state.hasNext} onClick={state.next} touch />
    </div>
  );
}
