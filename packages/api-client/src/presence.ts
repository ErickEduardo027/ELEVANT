export type PresenceState = "active" | "away" | "offline" | "unknown";
export interface PresenceHeartbeat {
  clientId: string; sequence: number; mode: "foreground" | "background" | "closed"; activityObserved: boolean;
}
/** Chosen by the account itself; the server publishes it only while that account is connected. */
export type PresenceAvailability = "available" | "busy" | "doNotDisturb" | "beRightBack" | "away" | "appearOffline";
export const PRESENCE_AVAILABILITIES: readonly PresenceAvailability[] =
  ["available", "busy", "doNotDisturb", "beRightBack", "away", "appearOffline"];
export const PRESENCE_MESSAGE_MAX_LENGTH = 80;
export interface PresenceParticipant {
  accountId: string; name: string; role: "agent" | "occ"; state: PresenceState; lastActivityAt: string | null;
  availability: PresenceAvailability | null; message: string | null;
}
export interface PresenceStatusUpdate { availability: PresenceAvailability | null; message: string | null }
export interface OwnPresence { state: PresenceState; availability: PresenceAvailability | null; message: string | null }
export interface OperationalPresenceList {
  asOf: string; operations: { operationId: string; participants: PresenceParticipant[] }[];
}

/** One ephemeral lease. Commands and offline outboxes are deliberately independent. */
export function createPresenceLease({ clientId, write, getForeground }: {
  clientId: string;
  write: (heartbeat: PresenceHeartbeat) => Promise<unknown>;
  getForeground: () => boolean;
}) {
  let sequence = 0;
  let activity = 0;
  let acknowledged = 0;
  let activityAt: number | undefined;
  let closed = false;
  let disabled = false;
  let started = false;
  let again = false;
  let pending: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const flush = (): Promise<void> => {
    if (closed || disabled) return Promise.resolve();
    if (pending) { again = true; return pending; }
    const observed = activity;
    const activityAge = activityAt === undefined ? Infinity : Date.now() - activityAt;
    const body: PresenceHeartbeat = { clientId, sequence: ++sequence,
      mode: getForeground() ? "foreground" : "background", activityObserved: observed > acknowledged && activityAge >= 0 && activityAge < 300_000 };
    pending = Promise.resolve().then(() => write(body)).then(() => { acknowledged = observed; })
      .catch((error: unknown) => {
        const status = (error as { status?: number })?.status;
        if (status === 401 || status === 403 || status === 404) disabled = true;
      }).finally(() => {
        pending = undefined;
        if (again && !closed && !disabled) { again = false; void flush(); }
      });
    return pending;
  };
  return {
    activity() { if (!closed) { activity += 1; activityAt = Date.now(); } },
    flush,
    start() {
      if (started || closed) return;
      started = true;
      void flush();
      timer = setInterval(() => { void flush(); }, 30_000);
    },
    async pause(report = true) {
      if (timer !== undefined) { clearInterval(timer); timer = undefined; }
      if (report) await flush();
    },
    resume() {
      if (closed || disabled || !started) return;
      if (timer === undefined) timer = setInterval(() => { void flush(); }, 30_000);
      void flush();
    },
    async close() {
      if (closed) return;
      closed = true;
      if (timer !== undefined) clearInterval(timer);
      if (started && !disabled) {
        try { await write({ clientId, sequence: ++sequence, mode: "closed", activityObserved: false }); }
        catch { /* A lease expires server-side even when closure cannot be delivered. */ }
      }
    },
  };
}
