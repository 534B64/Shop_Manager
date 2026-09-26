import { IconButton } from './m3';
import type { KeysetState } from '../lib/keysetPaging';

/** Previous / next for newest-first keyset lists (no total — "Page N"). `touch` = 48px buttons (POS screens). */
export default function KeysetPager({ paging, touch }: {
  paging: Pick<KeysetState<unknown>, 'page' | 'hasPrev' | 'hasNext' | 'prev' | 'next'>; touch?: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-2 px-2 h-14 border-t border-outline-variant text-body-medium text-on-surface-variant">
      <span aria-live="polite" className="px-2">Page {paging.page}</span>
      <IconButton icon="chevronLeft" label="Newer" disabled={!paging.hasPrev} onClick={paging.prev} touch={touch} />
      <IconButton icon="chevronRight" label="Older" disabled={!paging.hasNext} onClick={paging.next} touch={touch} />
    </div>
  );
}
