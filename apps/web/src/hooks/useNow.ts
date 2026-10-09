"use client";

import {useEffect, useState} from "react";

/**
 * A ticking clock for countdowns.
 *
 * `Date.now()` cannot be called during render — it is impure, and on a server
 * render it would produce a value the client then disagrees with. This returns
 * `null` until the client has mounted, so callers must render an explicit
 * placeholder rather than a wrong duration, and it re-renders on a timer so
 * "expires in 4h" stays true without a manual refresh.
 */
export function useNow(intervalMs = 15_000): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    // setTimeout rather than a direct call: a synchronous setState in an effect
    // body triggers a cascading render.
    const first = setTimeout(tick, 0);
    const interval = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [intervalMs]);

  return now;
}

/** Seconds until `unixSeconds`, or null before the clock is available. */
export function secondsUntil(unixSeconds: number | undefined, now: number | null): number | null {
  if (now === null || unixSeconds === undefined) return null;
  return unixSeconds - Math.floor(now / 1000);
}
