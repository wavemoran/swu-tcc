/**
 * Best-effort fixed-window limiter held in isolate memory.
 *
 * Limitation: each isolate (and each Cloudflare location) counts separately and
 * the state vanishes when the isolate is evicted, so this only stops casual
 * hammering from one client. It is not a security boundary. See docs/free-tier.md.
 */
export interface Limiter {
  /** Returns 0 if allowed, otherwise the seconds until the window resets. */
  hit(key: string, now?: number): number;
}

export function createLimiter(limit = 60, windowMs = 60_000, maxKeys = 2000): Limiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    hit(key, now = Date.now()) {
      let w = windows.get(key);
      if (!w || now - w.start >= windowMs) {
        if (windows.size >= maxKeys) {
          for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
          if (windows.size >= maxKeys) windows.clear();
        }
        w = { start: now, count: 0 };
        windows.set(key, w);
      }
      w.count += 1;
      return w.count > limit ? Math.max(1, Math.ceil((w.start + windowMs - now) / 1000)) : 0;
    },
  };
}
