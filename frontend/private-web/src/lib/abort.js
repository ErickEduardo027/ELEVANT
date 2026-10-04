const effectCleanupAbortReasons = new WeakSet();

export function isAbortError(error) {
  return typeof error === 'object' && error !== null && error.name === 'AbortError';
}

export function abortForEffectCleanup(controller) {
  if (controller.signal.aborted) return;
  const reason = new DOMException('Request cancelled because its owning effect was cleaned up.', 'AbortError');
  effectCleanupAbortReasons.add(reason);
  controller.abort(reason);
}

export function suppressExpectedEffectAbort(event) {
  if (!effectCleanupAbortReasons.has(event.reason)) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}
