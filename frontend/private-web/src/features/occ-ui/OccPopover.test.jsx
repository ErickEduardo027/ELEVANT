import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OccPopover from './OccPopover';

afterEach(cleanup);

function Example({ children, ...props }) {
  return (
    <div>
      <OccPopover trigger="Fuentes al día" panelLabel="Fuentes de datos" {...props}>
        {children ?? <p>Operación ELEVANT: al día</p>}
      </OccPopover>
      <button type="button">Otra cosa</button>
    </div>
  );
}

const hasClass = (element, name) => element.className.split(/\s+/).includes(name);

describe('OccPopover', () => {
  it('opens a named, non-modal dialog from a button that says what it controls', async () => {
    render(<Example />);
    const button = screen.getByRole('button', { name: 'Fuentes al día' });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Fuentes de datos' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', dialog.id);
    // Not modal: the map behind keeps its keys (contratos 2.2 skips only aria-modal dialogs).
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(dialog).toHaveTextContent('Operación ELEVANT: al día');
    // Focus moves into it, so a screen reader reads it.
    expect(dialog).toHaveFocus();

    // The same button closes it.
    await userEvent.click(button);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).not.toHaveAttribute('aria-controls');
  });

  it('opens with Enter and with Space from the keyboard', async () => {
    render(<Example />);
    await userEvent.tab();
    const button = screen.getByRole('button', { name: 'Fuentes al día' });
    expect(button).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Fuentes de datos' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(screen.getByRole('dialog', { name: 'Fuentes de datos' })).toBeInTheDocument();
  });

  it('Esc closes it, prevents default and returns focus; with nothing open Esc goes on', async () => {
    render(<Example />);
    const button = screen.getByRole('button', { name: 'Fuentes al día' });
    await userEvent.click(button);
    // fireEvent answers false when a handler called preventDefault().
    expect(fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    // Closed, it leaves Esc to whoever listens next, such as a map clearing its selection.
    expect(fireEvent.keyDown(button, { key: 'Escape' })).toBe(true);

    // An Esc that another handler already took is not its business either.
    await userEvent.click(button);
    const taken = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    taken.preventDefault();
    screen.getByRole('dialog').dispatchEvent(taken);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('one Esc closes only the innermost of two nested popovers', async () => {
    render(
      <OccPopover trigger="Cuenta" panelLabel="Menú de la cuenta">
        <OccPopover trigger="Leyenda" panelLabel="Leyenda"><p>Libre</p></OccPopover>
      </OccPopover>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cuenta' }));
    await userEvent.click(screen.getByRole('button', { name: 'Leyenda' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(2);

    await userEvent.keyboard('{Escape}');
    expect(screen.getAllByRole('dialog').map(dialog => dialog.getAttribute('aria-label'))).toEqual(['Menú de la cuenta']);
    expect(screen.getByRole('button', { name: 'Leyenda' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cuenta' })).toHaveFocus();
  });

  it('closes on a pointer press outside and when focus moves to another control, not while used', async () => {
    render(<Example><p>Texto del panel</p><button type="button">Dentro</button></Example>);
    const button = screen.getByRole('button', { name: 'Fuentes al día' });
    await userEvent.click(button);
    await userEvent.click(screen.getByText('Texto del panel'));
    await userEvent.click(screen.getByRole('button', { name: 'Dentro' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(button);
    act(() => screen.getByRole('button', { name: 'Dentro' }).focus());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    act(() => screen.getByRole('button', { name: 'Otra cosa' }).focus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('tells onOpenChange and hands close to a function child', async () => {
    const onOpenChange = vi.fn();
    render(
      <OccPopover trigger="Cuenta" panelLabel="Menú de la cuenta" onOpenChange={onOpenChange}>
        {({ close }) => <button type="button" onClick={close}>Listo</button>}
      </OccPopover>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cuenta' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole('button', { name: 'Listo' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
  });

  it('names its button with label when the content is not its name, and aligns the panel under either edge', async () => {
    const view = render(
      <OccPopover label="Menú de Alex Operations" trigger={<span aria-hidden="true">AO</span>} panelLabel="Cuenta">
        Alex Operations
      </OccPopover>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Menú de Alex Operations' }));
    const atEnd = screen.getByRole('dialog', { name: 'Cuenta' });
    expect(hasClass(atEnd, 'right-0')).toBe(true);
    expect(hasClass(atEnd, 'left-0')).toBe(false);
    view.unmount();

    render(<Example align="start" panelClassName="w-80 sm:fixed" />);
    await userEvent.click(screen.getByRole('button', { name: 'Fuentes al día' }));
    const atStart = screen.getByRole('dialog');
    expect(hasClass(atStart, 'left-0')).toBe(true);
    expect(hasClass(atStart, 'right-0')).toBe(false);
    // The caller sizes or places the panel; below 640 px it always spans the screen under the bar.
    for (const name of ['w-80', 'sm:fixed', 'max-sm:fixed', 'max-sm:inset-x-2', 'max-sm:top-12']) {
      expect(hasClass(atStart, name), name).toBe(true);
    }
  });
});
