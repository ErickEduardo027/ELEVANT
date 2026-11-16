import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import OccDrawer, { OCC_DRAWER_LAYOUT } from './OccDrawer';
import { isOverlayOpen } from './occShortcuts';

afterEach(() => {
  cleanup();
  resetLanguageForTests();
});

function drawer(props) {
  return (
    <LanguageScope>
      <OccDrawer open title="Alertas y avisos" onClose={vi.fn()} {...props}>
        <button type="button">Recibido</button>
      </OccDrawer>
    </LanguageScope>
  );
}

// A button that opens the drawer, as the status bar does; `returnFocus` passes the button to the drawer.
function Opener({ returnFocus = false }) {
  const [open, setOpen] = useState(false);
  const button = useRef(null);
  return (
    <LanguageScope>
      <button ref={button} type="button" onClick={() => setOpen(true)}>3 alertas</button>
      <button type="button">Otra cosa</button>
      <OccDrawer open={open} onClose={() => setOpen(false)} title="Alertas y avisos"
        returnFocusRef={returnFocus ? button : undefined} footer={<a href="/admin-occ/notifications">Historial</a>}>
        <button type="button">Recibido</button>
      </OccDrawer>
    </LanguageScope>
  );
}

const classesOf = element => element.className.split(/\s+/).filter(Boolean);

describe('OccDrawer', () => {
  it('is a modal dialog labelled by its title and closes on the scrim', async () => {
    const onClose = vi.fn();
    render(drawer({ onClose, id: 'occ-alerts' }));
    const dialog = screen.getByRole('dialog', { name: 'Alertas y avisos' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('id', 'occ-alerts');
    expect(screen.getByRole('heading', { level: 2, name: 'Alertas y avisos' }).id).toBe(dialog.getAttribute('aria-labelledby'));
    // While it is open the map's keys stand down (contratos 2.2).
    expect(isOverlayOpen(document)).toBe(true);
    // Focus starts inside it, on its first control.
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus();

    // The veil closes it with a press, and so does «Cerrar».
    await userEvent.click(document.querySelector('[data-occ-drawer-scrim]'));
    expect(onClose).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    // A press inside the panel does not.
    await userEvent.click(screen.getByRole('button', { name: 'Recibido' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('is named by labelledBy when given, and renders nothing while closed', () => {
    const view = render(<>
      <p id="external-title">Otro nombre</p>
      {drawer({ labelledBy: 'external-title' })}
    </>);
    expect(screen.getByRole('dialog', { name: 'Otro nombre' })).toBeInTheDocument();
    view.rerender(drawer({ open: false }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('[data-occ-drawer]')).toBeNull();
    expect(isOverlayOpen(document)).toBe(false);
  });

  it('closes on Esc with preventDefault, and leaves an Esc someone already took', () => {
    const onClose = vi.fn();
    render(drawer({ onClose }));
    const target = screen.getByRole('button', { name: 'Recibido' });
    const escape = createEvent.keyDown(target, { key: 'Escape' });
    fireEvent(target, escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();

    // An inner control that closed itself on this Esc already marked it: the drawer stays.
    const taken = createEvent.keyDown(target, { key: 'Escape' });
    taken.preventDefault();
    fireEvent(target, taken);
    expect(onClose).toHaveBeenCalledOnce();
    // Other keys are not its business.
    const enter = createEvent.keyDown(target, { key: 'Enter' });
    fireEvent(target, enter);
    expect(enter.defaultPrevented).toBe(false);
  });

  it('keeps Tab inside and gives focus back to its opener', async () => {
    const user = userEvent.setup();
    render(<Opener />);
    const opener = screen.getByRole('button', { name: '3 alertas' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Alertas y avisos' });
    for (let step = 0; step < 6; step += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement), String(step)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('gives focus to returnFocusRef even when the opening click did not focus it', async () => {
    render(<Opener returnFocus />);
    const opener = screen.getByRole('button', { name: '3 alertas' });
    // As in a browser that does not focus a clicked button: focus stays where it was.
    screen.getByRole('button', { name: 'Otra cosa' }).focus();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog', { name: 'Alertas y avisos' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(opener).toHaveFocus();
  });

  it('is a bottom sheet below 640 px and a panel on the right from there, flat and on its tokens', () => {
    render(drawer());
    const dialog = screen.getByRole('dialog');
    const classes = classesOf(dialog);
    for (const part of ['panel', 'sheet', 'side']) {
      expect(classes, part).toEqual(expect.arrayContaining(OCC_DRAWER_LAYOUT[part].split(/\s+/)));
    }
    // The sheet is the narrow layout, with no screen prefix; every rule of the side panel starts at 640 px (sm).
    const sheet = OCC_DRAWER_LAYOUT.sheet.split(/\s+/);
    const side = OCC_DRAWER_LAYOUT.side.split(/\s+/);
    expect(sheet.filter(name => name.includes(':'))).toEqual([]);
    expect(sheet).toEqual(expect.arrayContaining(['max-h-[85dvh]', 'rounded-t-[var(--occ-radius-overlay)]', 'border-t']));
    expect(side.every(name => name.startsWith('sm:'))).toBe(true);
    expect(side).toEqual(expect.arrayContaining(['sm:h-full', 'sm:border-l', 'sm:rounded-bl-[var(--occ-radius-overlay)]']));
    // Over the veil, under the toasts; no shadow on the panel.
    expect(classesOf(document.querySelector('[data-occ-drawer]'))).toEqual(expect.arrayContaining(['fixed', 'inset-0', 'z-drawer']));
    expect(classesOf(document.querySelector('[data-occ-drawer-scrim]'))).toContain('bg-occ-scrim');
    expect(classes).toEqual(expect.arrayContaining(['bg-occ-panel', 'border-occ-line']));
    expect(classes.filter(name => /shadow/.test(name))).toEqual([]);
  });

  it('names its close button in English inside a translated scope', () => {
    resetLanguageForTests('en');
    render(drawer({ title: 'Alerts and notices' }));
    expect(screen.getByRole('dialog', { name: 'Alerts and notices' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
