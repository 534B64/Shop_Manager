// One screen answers: what's due, what's owed, what's low. Reference page for
// the M3 foundation (docs/UI-GUIDE.md): small components, token classes only,
// each card loads its own data so one slow request never blanks the page.
import { useState } from 'react';
import { Chip } from '../../components/m3';
import { isCounterMode, savePrefs } from '../../lib/session';
import { getPrefs, type Prefs, type DashboardPrefs } from '../../lib/theme';
import DueSoonCard from './DueSoonCard';
import OwedCard from './OwedCard';
import LowStockCard from './LowStockCard';

const CARD_LABELS: Record<keyof DashboardPrefs, string> = { due: 'Due soon', owed: 'Owed', low: 'Low stock' };

export default function Dashboard() {
  const [prefs, setPrefs] = useState<Prefs>(getPrefs);
  const cards = prefs.dashboard ?? { due: true, owed: true, low: true };
  const counter = isCounterMode();
  const toggle = (k: keyof DashboardPrefs) => {
    const next = { ...prefs, dashboard: { ...cards, [k]: !cards[k] } };
    setPrefs(next); savePrefs(next);
  };
  const keys = (Object.keys(CARD_LABELS) as (keyof DashboardPrefs)[]).filter((k) => !(counter && k === 'owed'));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-headline-medium">Dashboard</h1>
          <p className="text-body-medium text-on-surface-variant">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Cards to show">
          {keys.map((k) => (
            <Chip key={k} kind="filter" selected={cards[k]} onClick={() => toggle(k)}>{CARD_LABELS[k]}</Chip>
          ))}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.due && <DueSoonCard />}
        {!counter && cards.owed && <OwedCard />}
        {cards.low && <LowStockCard />}
      </div>
    </div>
  );
}
