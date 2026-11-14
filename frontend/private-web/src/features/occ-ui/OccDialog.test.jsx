import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import OccButton from './OccButton';
import OccDialog, { OCC_DIALOG_CANCEL, OCC_DIALOG_LAYOUT, OCC_DIALOG_SIZES, OCC_DIALOG_TONES } from './OccDialog';
import { isOverlayOpen } from './occShortcuts';

afterEach(() => {
  cleanup();
  act(() => resetLanguageForTests('es'));
});

const classesOf = element => element.className.split(/\s+/).filter(Boolean);
const cancelMark = { [OCC_DIALOG_CANCEL]: '' };

// What a browser does when the focused control can no longer take the focus, at its next frame (the focus fixup rule
// of HTML, which jsdom does not apply): the focus goes to the page, and so do the keys. jsdom will not blur a disabled
// control, so the page takes the focus for a moment.
function applyFocusFixup() {
  const active = document.activeElement;
  if (!active || active === document.body || !active.matches(':disabled')) return;
  document.body.tabIndex = -1;
  document.body.focus();
  document.body.removeAttribute('tabindex');
}

// A dialog with a cancel and a confirm in its footer, as Tablets and Revisión build theirs.
function confirmFooter({ onCancel = () => {}, onConfirm = () => {}, busy = false } = {}) {
  return <>
    <OccButton onClick={onCancel} disabled={busy} {...cancelMark}>Cancelar</OccButton>
    <OccButton variant="danger" onClick={onConfirm} busy={busy} busyLabel="Revocando…">Revocar</OccButton>
  </>;
}

// A button that opens the dialog; `returnFocus` passes the button to the dialog.
function Opener({ tone = 'default', returnFocus = false }) {
  const [open, setOpen] = useState(false);
  const button = useRef(null);
  return (
    <LanguageScope>
      <button ref={button} type="button" onClick={() => setOpen(true)}>Revocar tablet</button>
      <button type="button">Otra cosa</button>
      <OccDialog open={open} onClose={() => setOpen(false)} title="Revocar la tablet TAB-07" tone={tone}
        returnFocusRef={returnFocus ? button : undefined} footer={confirmFooter({ onCancel: () => setOpen(false) })}>
        <label>Motivo <textarea /></label>
      </OccDialog>
    </LanguageScope>
  );
}

describe('OccDialog', () => {
  it('is a modal dialog named by its title and renders nothing closed', () => {
    const view = render(
      <OccDialog open title="Liberar la tablet" descriptionId="release-note" onClose={() => {}} data-testid="release">
        <p id="release-note">El agente tendrá que volver a iniciar sesión.</p>
      </OccDialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Liberar la tablet' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('data-testid', 'release');
    expect(dialog).toHaveAccessibleDescription('El agente tendrá que volver a iniciar sesión.');
    expect(screen.getByRole('heading', { level: 2, name: 'Liberar la tablet' }).id).toBe(dialog.getAttribute('aria-labelledby'));
    expect(dialog).not.toHaveAttribute('aria-busy');
    // While it is open the map's keys stand down (contratos 2.2); focus starts on its first control.
    expect(isOverlayOpen(document)).toBe(true);
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus();

    // Flat panel on its tokens, over the veil, a bottom sheet that centres itself from 640 px.
    const classes = classesOf(dialog);
    expect(classes).toEqual(expect.arrayContaining([...OCC_DIALOG_LAYOUT.panel.split(' '), 'sm:max-w-md']));
    expect(classes).toEqual(expect.arrayContaining(['bg-occ-panel', 'border-occ-line',
      'rounded-t-[var(--occ-radius-overlay)]', 'sm:rounded-[var(--occ-radius-overlay)]']));
    expect(classes.filter(name => /shadow|blur/.test(name))).toEqual([]);
    expect(classesOf(document.querySelector('[data-occ-dialog]'))).toEqual(expect.arrayContaining(['fixed', 'inset-0',
      'z-modal', 'items-end', 'sm:items-center']));
    expect(classesOf(document.querySelector('[data-occ-dialog-scrim]'))).toContain('bg-occ-scrim');

    view.rerender(<OccDialog open={false} title="Liberar la tablet" onClose={() => {}}><p>Texto</p></OccDialog>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('[data-occ-dialog]')).toBeNull();
    expect(isOverlayOpen(document)).toBe(false);
  });

  it('tone danger is an alertdialog whose first focus is cancel', async () => {
    const user = userEvent.setup();
    render(<Opener tone="danger" />);
    await user.click(screen.getByRole('button', { name: 'Revocar tablet' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Revocar la tablet TAB-07' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // A hasty Enter cancels: focus starts on «Cancelar», not on «Cerrar» or «Revocar».
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    // initialFocusRef wins over the first control of a default dialog.
    function Focused() {
      const reason = useRef(null);
      return (
        <OccDialog open title="Devolver la entrega" initialFocusRef={reason} onClose={() => {}}>
          <label>Correcciones <textarea ref={reason} /></label>
        </OccDialog>
      );
    }
    render(<Focused />);
    expect(screen.getByRole('textbox', { name: 'Correcciones' })).toHaveFocus();
    expect(OCC_DIALOG_TONES).toEqual(['default', 'danger']);
  });

  it('keeps Tab inside, closes on Esc with preventDefault and on the scrim, and returns focus', async () => {
    const user = userEvent.setup();
    render(<Opener />);
    const opener = screen.getByRole('button', { name: 'Revocar tablet' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Revocar la tablet TAB-07' });
    for (let step = 0; step < 6; step += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement), String(step)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Esc closes it, marked as used, and focus goes back to the opener.
    const target = within(dialog).getByRole('textbox');
    const escape = createEvent.keyDown(target, { key: 'Escape' });
    fireEvent(target, escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    // The veil closes it with a press, and so does «Cerrar»; a press inside the panel does not.
    await user.click(opener);
    await user.click(within(screen.getByRole('dialog')).getByRole('textbox'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(document.querySelector('[data-occ-dialog-scrim]'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('leaves an Esc someone already took and gives focus to returnFocusRef', async () => {
    const onClose = vi.fn();
    const { unmount } = render(<OccDialog open title="Editar vuelo" onClose={onClose}><input aria-label="Vuelo" /></OccDialog>);
    const input = screen.getByRole('textbox', { name: 'Vuelo' });
    const taken = createEvent.keyDown(input, { key: 'Escape' });
    taken.preventDefault();
    fireEvent(input, taken);
    expect(onClose).not.toHaveBeenCalled();
    const enter = createEvent.keyDown(input, { key: 'Enter' });
    fireEvent(input, enter);
    expect(enter.defaultPrevented).toBe(false);
    unmount();

    render(<Opener returnFocus />);
    const opener = screen.getByRole('button', { name: 'Revocar tablet' });
    // As in a browser that does not focus a clicked button: focus stays where it was.
    screen.getByRole('button', { name: 'Otra cosa' }).focus();
    fireEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('does not close while busy', async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <OccDialog open busy title="Revocar la tablet TAB-07" tone="danger" onClose={onClose}
        footer={confirmFooter({ busy: true })}>
        <p>La tablet deja de poder iniciar sesión.</p>
      </OccDialog>,
    );
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-busy', 'true');
    // Neither Esc, nor the veil, nor «Cerrar» closes it while the command is on its way.
    const escape = createEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent(dialog, escape);
    expect(escape.defaultPrevented).toBe(true);
    fireEvent.click(document.querySelector('[data-occ-dialog-scrim]'));
    const close = screen.getByRole('button', { name: 'Cerrar' });
    expect(close).toBeDisabled();
    fireEvent.click(close);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Revocando…' })).toHaveAttribute('aria-busy', 'true');

    // Done, it closes again.
    rerender(
      <OccDialog open title="Revocar la tablet TAB-07" tone="danger" onClose={onClose} footer={confirmFooter()}>
        <p>La tablet deja de poder iniciar sesión.</p>
      </OccDialog>,
    );
    expect(screen.getByRole('alertdialog')).not.toHaveAttribute('aria-busy');
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps the focus on its busy confirm, so Tab and Esc still work after a failed command', async () => {
    const user = userEvent.setup();
    let reject;
    const command = vi.fn(() => new Promise((resolve, fail) => { reject = fail; }));
    function Revoke() {
      const [open, setOpen] = useState(true);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      async function confirm() {
        setBusy(true);
        try {
          await command();
        } catch {
          setError('No se pudo revocar la tablet. Vuelve a intentarlo.');
        } finally {
          setBusy(false);
        }
      }
      return (
        <LanguageScope>
          <OccDialog open={open} onClose={() => setOpen(false)} title="Revocar la tablet TAB-07" tone="danger" busy={busy}
            footer={confirmFooter({ onCancel: () => setOpen(false), onConfirm: () => void confirm(), busy })}>
            {error ? <p role="alert">{error}</p> : <p>La tablet deja de poder iniciar sesión.</p>}
          </OccDialog>
        </LanguageScope>
      );
    }
    render(<Revoke />);
    const dialog = screen.getByRole('alertdialog', { name: 'Revocar la tablet TAB-07' });
    // From «Cancelar», where a danger dialog starts, Tab reaches «Revocar», and Enter sends the command.
    await user.tab();
    await user.keyboard('{Enter}');
    expect(command).toHaveBeenCalledOnce();

    // On its way, the confirm keeps the focus: Esc reaches the dialog, which stays open while it is busy.
    applyFocusFixup();
    const confirm = within(dialog).getByRole('button', { name: 'Revocando…' });
    expect(confirm).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(dialog).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(command).toHaveBeenCalledOnce();

    // It fails: the dialog stays with its message and the focus is still inside it.
    await act(async () => { reject(new TypeError('Failed to fetch')); });
    applyFocusFixup();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('No se pudo revocar la tablet. Vuelve a intentarlo.');
    expect(within(dialog).getByRole('button', { name: 'Revocar' })).toHaveFocus();
    for (let step = 0; step < 4; step += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement), String(step)).toBe(true);
    }
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    // A disabled confirm would have lost it: the fixup moves the focus off a control that gets disabled.
    render(<button type="button">Probar</button>);
    const probe = screen.getByRole('button', { name: 'Probar' });
    probe.focus();
    probe.disabled = true;
    applyFocusFixup();
    expect(document.body).toHaveFocus();
  });

  it('renders in place, so the region around it contains its buttons', () => {
    render(
      <section aria-label="Detalle de entrega">
        <h2>OP-0412</h2>
        <OccDialog open title="Aprobar la entrega" onClose={() => {}}
          footer={<OccButton variant="primary">Confirmar decisión</OccButton>}>
          <p>La entrega queda aprobada y registrada.</p>
        </OccDialog>
      </section>,
    );
    // No portal: the dialog is a descendant of the region, as the cycle E2E reads «Confirmar decisión».
    const detail = screen.getByRole('region', { name: 'Detalle de entrega' });
    expect(detail.contains(screen.getByRole('dialog', { name: 'Aprobar la entrega' }))).toBe(true);
    expect(within(detail).getByRole('button', { name: 'Confirmar decisión' })).toBeInTheDocument();
  });

  it('names its close button in English inside a translated scope, is wider with size lg, and refuses unknown values', () => {
    act(() => resetLanguageForTests('en'));
    render(
      <LanguageScope>
        <OccDialog open size="lg" title="Device history" onClose={() => {}}><p>History</p></OccDialog>
      </LanguageScope>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(classesOf(screen.getByRole('dialog', { name: 'Device history' }))).toContain('sm:max-w-2xl');
    expect(OCC_DIALOG_SIZES).toEqual(['md', 'lg']);

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<OccDialog open tone="warning" title="X" onClose={() => {}} />)).toThrow(RangeError);
      expect(() => render(<OccDialog open size="xl" title="X" onClose={() => {}} />)).toThrow(/Unknown OCC dialog size: xl/);
    } finally {
      consoleError.mockRestore();
    }
  });
});
