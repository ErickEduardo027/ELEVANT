import { expect, it, vi } from 'vitest';
import { abortForEffectCleanup, isAbortError, suppressExpectedEffectAbort } from './abort';

it('recognizes AbortError rejections without swallowing ordinary failures', () => {
  expect(isAbortError(new DOMException('signal is aborted without reason', 'AbortError'))).toBe(true);
  expect(isAbortError({ name: 'AbortError' })).toBe(true);
  expect(isAbortError(new TypeError('offline'))).toBe(false);
  expect(isAbortError(null)).toBe(false);
});

it('marks only effect-cleanup aborts for the development rejection reporter', () => {
  const controller = new AbortController();
  abortForEffectCleanup(controller);
  const event = {
    reason: controller.signal.reason,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  };

  expect(isAbortError(event.reason)).toBe(true);
  expect(suppressExpectedEffectAbort(event)).toBe(true);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();

  const realFailure = {
    reason: new DOMException('aborted by another source', 'AbortError'),
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  };
  expect(suppressExpectedEffectAbort(realFailure)).toBe(false);
  expect(realFailure.preventDefault).not.toHaveBeenCalled();
  expect(realFailure.stopImmediatePropagation).not.toHaveBeenCalled();
});
