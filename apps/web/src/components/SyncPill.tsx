import { RefreshCw } from 'lucide-react';
import { formatAge, minutesAgo } from '../format.ts';
import { useNow } from '../hooks.ts';

export function SyncPill({
  fetchedAt,
  onRefresh,
  refreshing,
  mock,
}: {
  fetchedAt: string | null;
  onRefresh: () => void;
  refreshing: boolean;
  mock: boolean;
}) {
  const now = useNow();
  const mins = minutesAgo(fetchedAt, now);
  const stale = mins === null || mins > 15;
  const source = mock ? 'MOCK DATA' : 'MELEE.GG';
  return (
    <div className="sync">
      <p className={`pill ${stale ? 'stale' : 'fresh'}`}>
        <span className="dot" aria-hidden="true">
          ●
        </span>{' '}
        <span>
          {stale ? 'STALE' : 'SYNCED'} · {source}
          {mins !== null && ` · ${formatAge(mins)}`}
        </span>
      </p>
      <button type="button" className="btn ghost icon" onClick={onRefresh} disabled={refreshing} aria-label="Refresh standings from Melee.gg">
        <RefreshCw size={18} className={refreshing ? 'spin' : undefined} aria-hidden="true" />
        <span className="sr-only" aria-live="polite">
          {refreshing ? 'Refreshing' : ''}
        </span>
      </button>
    </div>
  );
}
