import { ElevantApiError } from "@elevant/api-client";

/** Idempotency-Key of one user intent, kept while the same action and body are retried. */
export interface CommandKeyHolder {
  /** Key for this intent; another action or body starts a new intent with a new key. */
  keyFor(action: string, body: unknown): string;
  /** Sends the command with its key and settles the intent according to the answer. */
  run<T>(action: string, body: unknown, send: (key: string) => Promise<T>): Promise<T>;
  /** Forgets the intent, for example when the user discards the form. */
  reset(): void;
}

/**
 * The same UUID is kept while the user retries the same [action, body] after an uncertain result (no answer, a 5xx),
 * so the server replays the first result instead of repeating the command. Any answer the server gave (2xx or 4xx)
 * settles the intent and the next attempt gets a new key. A network failure reaches here as a TypeError, like an
 * input the client refuses before sending: both keep the key, which is harmless for the second (a corrected body is
 * another intent) and required for the first.
 */
export function createCommandKeyHolder(newKey: () => string = () => crypto.randomUUID()): CommandKeyHolder {
  let current: { signature: string; key: string } | null = null;
  const settled = (error: unknown) =>
    error instanceof ElevantApiError && error.kind === "http" && error.status >= 400 && error.status < 500;
  return {
    keyFor(action, body) {
      const signature = JSON.stringify([action, body ?? null]);
      if (!current || current.signature !== signature) current = { signature, key: newKey() };
      return current.key;
    },
    async run(action, body, send) {
      const key = this.keyFor(action, body);
      try {
        const result = await send(key);
        current = null;
        return result;
      } catch (error) {
        if (settled(error)) current = null;
        throw error;
      }
    },
    reset() { current = null; },
  };
}
