import { Button, Icon, cx } from '../../../components/m3';
import { formatCents } from '../../../lib/format';
import { formatWhen } from '../lib/when';
import type { DrawerView } from '../types';

/** One line at the top of the counter: is the cash drawer open, and who opened it. */
export default function DrawerStatusBar({ drawer, loading, error, onRetry }: {
  drawer: DrawerView | null | undefined; loading: boolean; error: string | null; onRetry: () => void;
}) {
  const open = !!drawer;
  const known = drawer !== undefined;
  return (
    <div role="status" className={cx('flex flex-wrap items-center gap-3 rounded-shape-medium px-4 py-2 min-h-14 mb-4',
      error ? 'bg-error-container text-on-error-container'
        : !known ? 'bg-surface-container-highest text-on-surface-variant'
        : open ? 'bg-success-container text-on-success-container' : 'bg-warning-container text-on-warning-container')}>
      <Icon name={error || (known && !open) ? 'warning' : open ? 'check' : 'info'} />
      <p className="flex-1 min-w-0 text-body-large">
        {error ? <>Couldn’t check the drawer: {error}</>
          : !known ? (loading ? 'Checking the cash drawer…' : 'Drawer status unknown')
          : open ? <><b>Drawer #{drawer.id} open</b> · {drawer.openedByName ?? 'someone'} opened it {formatWhen(drawer.openedAt)} · float {formatCents(drawer.openingFloatCents)}</>
          : <><b>Drawer closed</b> — card and check sales work; cash needs the drawer opened first.</>}
      </p>
      {error
        ? <Button variant="elevated" touch onClick={onRetry}>Try again</Button>
        : <Button variant={open ? "elevated" : "filled"} touch to="/pos/drawer">{open ? 'Drawer' : 'Open drawer'}</Button>}
    </div>
  );
}
