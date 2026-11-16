import { renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useEscapeToClose } from './useEscapeToClose';

const press = (key, target = document.body) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

afterEach(() => vi.restoreAllMocks());

it('calls preventDefault and onClose on Escape while active and ignores other keys', () => {
  const onClose = vi.fn();
  const { rerender, unmount } = renderHook(({ active }) => useEscapeToClose(active, onClose), { initialProps: { active: true } });

  // Other keys pass through untouched.
  for (const key of ['Enter', 'a', '1', 'Esc']) expect(press(key).defaultPrevented, key).toBe(false);
  expect(onClose).not.toHaveBeenCalled();

  // Escape closes and is marked as used, so the map keys under the drawer leave the selection alone.
  const escape = press('Escape');
  expect(escape.defaultPrevented).toBe(true);
  expect(onClose).toHaveBeenCalledOnce();
  // It is heard on the window from anywhere in the page, a field included.
  const field = document.body.appendChild(document.createElement('input'));
  expect(press('Escape', field).defaultPrevented).toBe(true);
  expect(onClose).toHaveBeenCalledTimes(2);
  field.remove();

  // An Escape another handler already used still closes: with stacked modals each one closes on its own listener.
  const used = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  used.preventDefault();
  window.dispatchEvent(used);
  expect(onClose).toHaveBeenCalledTimes(3);

  // Inactive or unmounted, it neither closes nor marks the key.
  rerender({ active: false });
  expect(press('Escape').defaultPrevented).toBe(false);
  rerender({ active: true });
  unmount();
  expect(press('Escape').defaultPrevented).toBe(false);
  expect(onClose).toHaveBeenCalledTimes(3);
});
