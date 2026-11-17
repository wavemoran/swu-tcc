// localStorage can throw (private mode, blocked site data); never let that break the app.
export function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export const lastPlayerKey = (tournamentId: string) => `swu-tcc:player:${tournamentId}`;
export const getLastPlayer = (tournamentId: string) => safeGet(lastPlayerKey(tournamentId));
export const setLastPlayer = (tournamentId: string, playerId: string) => safeSet(lastPlayerKey(tournamentId), playerId);
