/**
 * Idempotency-Key of one user intent. The same UUID is kept while the user retries the same
 * [action, body] after an uncertain result (no answer, or a 5xx), so the server replays the first
 * result instead of repeating the command. Any 2xx or 4xx answer settles the intent and the next
 * attempt gets a new key. In React keep it in `useRef(createCommandKeyHolder())`.
 *
 * @param {() => string} [newKey]
 */
export function createCommandKeyHolder(newKey = () => globalThis.crypto.randomUUID()) {
  let current = null;
  const settled = error => typeof error?.status === 'number' && error.status >= 400 && error.status < 500;
  return {
    /** Key for this intent; a different action or body starts a new intent. */
    keyFor(action, body) {
      const signature = JSON.stringify([action, body ?? null]);
      if (!current || current.signature !== signature) current = { signature, key: newKey() };
      return current.key;
    },
    /** Sends the command with its key and settles the intent according to the answer. */
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
    /** Forgets the intent, for example when the user discards the form. */
    reset() { current = null; },
  };
}
