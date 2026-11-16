import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ChatComposerInput from './ChatComposerInput';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('grows to its cap and shrinks only when the controlled draft is cleared', () => {
  vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(function () { return this.value.length > 8 ? 220 : 44; });
  const props = { 'aria-label': 'Mensaje', onChange: vi.fn(), scope: 'a' };
  const { rerender } = render(<ChatComposerInput {...props} value="" />);
  const input = screen.getByRole('textbox');
  expect(input).toHaveAttribute('rows', '1');
  expect(input.style.height).toBe('44px');
  rerender(<ChatComposerInput {...props} value="A long pending draft" disabled />);
  expect(input).toHaveValue('A long pending draft');
  expect(input.style.height).toBe('144px');
  expect(input.style.overflowY).toBe('auto');
  rerender(<ChatComposerInput {...props} value="" scope="b" />);
  expect(input.style.height).toBe('44px');
  expect(input.style.overflowY).toBe('hidden');
});

it('recalculates wrapping when the available width changes', () => {
  let width = 240;
  let observer;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { observer = callback; }
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLTextAreaElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width }));
  vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(() => width < 200 ? 200 : 44);
  render(<ChatComposerInput aria-label="Mensaje" value="draft" scope="a" onChange={vi.fn()} />);
  expect(screen.getByRole('textbox').style.height).toBe('44px');
  act(() => { width = 160; observer(); });
  expect(screen.getByRole('textbox').style.height).toBe('144px');
});
