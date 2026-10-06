import { fireEvent, render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import Drawer from './Drawer';

function renderDrawer(open, onClose = vi.fn()) {
  return render(
    <>
      <button type="button">Contenido subyacente</button>
      <Drawer open={open} onClose={onClose} title="Detalle">
        <button type="button">Primera acción</button>
      </Drawer>
    </>,
  );
}

it('uses the boolean inert state and restores focus when it closes', () => {
  const { container, rerender } = renderDrawer(false);
  const behind = container.querySelector('button');
  behind.focus();
  rerender(
    <>
      <button type="button">Contenido subyacente</button>
      <Drawer open onClose={vi.fn()} title="Detalle">
        <button type="button">Primera acción</button>
      </Drawer>
    </>,
  );
  const dialog = container.querySelector('[role="dialog"]');
  const closeButton = dialog.querySelector('button[aria-label="Cerrar"]');

  expect(dialog).not.toHaveAttribute('inert');
  expect(closeButton).toHaveFocus();

  rerender(
    <>
      <button type="button">Contenido subyacente</button>
      <Drawer open={false} onClose={vi.fn()} title="Detalle">
        <button type="button">Primera acción</button>
      </Drawer>
    </>,
  );

  expect(dialog).toHaveAttribute('inert');
  expect(dialog.parentElement).toHaveAttribute('aria-hidden', 'true');
  expect(behind).toHaveFocus();
});

it('closes on Escape while open', () => {
  const onClose = vi.fn();
  const { container } = renderDrawer(true, onClose);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledOnce();
  expect(container.querySelector('[role="dialog"]')).not.toHaveAttribute('inert');
});
