import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * ELEVANT's clock as the tablet knows it (3-N18). Every response carries the server's `Date` header; a quick round trip
 * gives the device's offset, which is kept on the device so «AHORA» stays right without signal. Every time the tablet
 * captures (milestones, damages, incidents, the start and the services) comes from {@link serverNow}; the screens
 * still show it in the station's local time. Not sensitive and not part of the session: it survives a sign-out.
 */
const STORAGE_KEY = 'elevant:mobile:server-clock:v1';
/** A sample with a longer round trip says too little about when the server answered. */
export const MAX_SAMPLE_ROUND_TRIP_MS = 5_000;
/** The clock tolerance ELEVANT accepts on every time the tablet captures (RampEvidenceTimePolicy.ClockTolerance). */
export const EVIDENCE_CLOCK_TOLERANCE_MS = 2 * 60_000;
/** Beyond the server's tolerance the agent is told to check the tablet's clock. */
export const CLOCK_WARNING_THRESHOLD_MS = EVIDENCE_CLOCK_TOLERANCE_MS;
/** Smaller changes are jitter of the one-second header and are not written again. */
const PERSIST_DELTA_MS = 1_000;

type Listener = (offsetMs: number) => void;
const listeners = new Set<Listener>();
let offsetMs = 0;
let persistedOffsetMs: number | null = null;
let loading: Promise<void> | null = null;

function publish(next: number) {
  offsetMs = next;
  for (const listener of listeners) listener(offsetMs);
}

/** Reads the last known offset once; until then (and on a first run) the device's clock applies. */
export function loadServerClock(): Promise<void> {
  loading ??= (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      const stored = typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>).offsetMs : undefined;
      if (typeof stored === 'number' && Number.isFinite(stored) && persistedOffsetMs === null) {
        persistedOffsetMs = stored;
        publish(stored);
      }
    } catch {
      // Without the stored offset the device's clock applies until the next response.
    }
  })();
  return loading;
}

/**
 * Takes the server's `Date` header of one response. The header has a one-second resolution, so its middle is the
 * estimate, compared with the middle of the round trip. Answers whether the sample was used.
 */
export function observeServerDate(dateHeader: string | null | undefined, sentAt: number, receivedAt: number): boolean {
  if (typeof dateHeader !== 'string' || dateHeader.length === 0) return false;
  const roundTrip = receivedAt - sentAt;
  if (!Number.isFinite(roundTrip) || roundTrip < 0 || roundTrip >= MAX_SAMPLE_ROUND_TRIP_MS) return false;
  const serverMs = Date.parse(dateHeader);
  if (!Number.isFinite(serverMs)) return false;
  const next = Math.round(serverMs + 500 - (sentAt + receivedAt) / 2);
  publish(next);
  if (persistedOffsetMs === null || Math.abs(next - persistedOffsetMs) >= PERSIST_DELTA_MS) {
    persistedOffsetMs = next;
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ offsetMs: next, observedAt: new Date(receivedAt).toISOString() }))
      .catch(() => {});
  }
  return true;
}

/** Now, by ELEVANT's clock. */
export function serverNow(): Date {
  return new Date(Date.now() + offsetMs);
}

/** How far ahead (positive) or behind the server the tablet's clock is: server minus device. */
export function clockOffsetMs(): number {
  return offsetMs;
}

/** The warning the screens show while the tablet's clock is off by more than the server's tolerance, or null. */
export function clockSkewWarning(offset = offsetMs): string | null {
  if (Math.abs(offset) <= CLOCK_WARNING_THRESHOLD_MS) return null;
  const minutes = Math.round(Math.abs(offset) / 60_000);
  return `La hora de esta tablet difiere ${minutes} min de ELEVANT; los registros se corrigen solos. Revisa la hora del equipo.`;
}

export function subscribeServerClock(listener: Listener) {
  listeners.add(listener);
  listener(offsetMs);
  return () => { listeners.delete(listener); };
}

/** Test hook: forgets the in-memory offset so a test can load it again from storage. */
export function resetServerClockForTests() {
  offsetMs = 0;
  persistedOffsetMs = null;
  loading = null;
  listeners.clear();
}
