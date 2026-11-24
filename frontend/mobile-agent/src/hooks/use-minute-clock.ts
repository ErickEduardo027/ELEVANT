import { useEffect, useState } from 'react';
import { serverNow } from '../synchronization/server-clock';
import { startForegroundInterval } from '../utils/foreground-interval';

const minuteOf = () => Math.floor(serverNow().getTime() / 60_000) * 60_000;

/**
 * ELEVANT's time rounded to the minute, for countdowns («Sale en 25 min»). It changes once a minute and only while the
 * app is in the foreground, so a list that reads it renders again once a minute, not on every tick.
 */
export function useMinuteClock() {
  const [now, setNow] = useState(minuteOf);
  useEffect(() => startForegroundInterval(() => {
    const next = minuteOf();
    setNow(previous => (previous === next ? previous : next));
  }, 15_000), []);
  return now;
}
