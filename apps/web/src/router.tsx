import { useSyncExternalStore } from 'react';
import type { AnchorHTMLAttributes, MouseEvent } from 'react';

const EVENT = 'swu-tcc:navigate';

function subscribe(cb: () => void) {
  window.addEventListener('popstate', cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener(EVENT, cb);
  };
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname, () => '/');
}

export function navigate(path: string, replace = false) {
  if (path === window.location.pathname) return;
  if (replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(EVENT));
  window.scrollTo?.(0, 0);
}

export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}

export type Route =
  | { name: 'landing' }
  | { name: 'manual' }
  | { name: 'privacy' }
  | { name: 'tournament'; id: string }
  | { name: 'player'; id: string; playerId: string }
  | { name: 'notfound' };

export function matchRoute(path: string): Route {
  const p = path.replace(/\/+$/, '') || '/';
  if (p === '/') return { name: 'landing' };
  if (p === '/manual') return { name: 'manual' };
  if (p === '/privacy') return { name: 'privacy' };
  let m = /^\/t\/(\d+)$/.exec(p);
  if (m) return { name: 'tournament', id: m[1]! };
  m = /^\/t\/(\d+)\/p\/([^/]+)$/.exec(p);
  if (m) return { name: 'player', id: m[1]!, playerId: decodeURIComponent(m[2]!) };
  return { name: 'notfound' };
}

export const tournamentPath = (id: string) => `/t/${id}`;
export const playerPath = (id: string, playerId: string) => `/t/${id}/p/${encodeURIComponent(playerId)}`;
