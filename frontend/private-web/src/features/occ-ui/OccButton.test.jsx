import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findLegacyColourClasses } from '../../styles/occLegacyBridge';
import OccButton, { OCC_BUTTON_SIZES, OCC_BUTTON_VARIANTS, occButtonClass } from './OccButton';

afterEach(cleanup);

const classesOf = element => element.className.split(/\s+/).filter(Boolean);

describe('OccButton', () => {
  it('primary is the light key and the variants and sizes use occ tokens with 44 px on coarse pointers', () => {
    expect(OCC_BUTTON_VARIANTS).toEqual(['primary', 'secondary', 'ghost', 'danger']);
    expect(OCC_BUTTON_SIZES).toEqual(['md', 'sm']);
    render(<>
      <OccButton variant="primary">Asignar posiciones</OccButton>
      <OccButton>Guardar</OccButton>
      <OccButton variant="ghost" size="sm">Ver en el mapa</OccButton>
      <OccButton variant="danger" className="ml-auto" data-testid="revoke">Revocar</OccButton>
    </>);
    const primary = classesOf(screen.getByRole('button', { name: 'Asignar posiciones' }));
    // The light key: the primary token with its own ink, lighter under the pointer; never the cyan accent.
    expect(primary).toEqual(expect.arrayContaining(['bg-occ-primary', 'text-occ-on-primary', 'hover:bg-occ-primary-hover']));
    expect(primary.filter(name => /accent/.test(name))).toEqual([]);

    const secondary = screen.getByRole('button', { name: 'Guardar' });
    expect(secondary).toHaveAttribute('type', 'button');
    expect(classesOf(secondary)).toEqual(expect.arrayContaining(['border', 'border-occ-line-strong', 'text-occ-text']));
    expect(classesOf(screen.getByRole('button', { name: 'Ver en el mapa' }))).toEqual(expect.arrayContaining([
      'text-occ-accent', 'h-7', 'px-2', 'text-xs',
    ]));
    const danger = screen.getByRole('button', { name: 'Revocar' });
    expect(danger).toHaveAttribute('data-testid', 'revoke');
    // Red joint and red text; on the red slab under the pointer the text turns plain, so it keeps its contrast.
    expect(classesOf(danger)).toEqual(expect.arrayContaining([
      'border-occ-danger', 'text-occ-danger', 'hover:bg-occ-danger-soft', 'hover:text-occ-text',
    ]));
    expect(classesOf(danger).at(-1)).toBe('ml-auto');

    for (const button of screen.getAllByRole('button')) {
      const classes = classesOf(button);
      // 32 px (or 28 px small) with a mouse, 44 px high and wide on a touch screen, on the 4 px control radius.
      expect(classes.some(name => name === 'h-8' || name === 'h-7'), button.textContent).toBe(true);
      expect(classes).toEqual(expect.arrayContaining(['rounded', '[@media(pointer:coarse)]:h-11',
        '[@media(pointer:coarse)]:min-w-11', 'font-semibold']));
      expect(findLegacyColourClasses(button.className), button.textContent).toEqual([]);
      expect(classes.filter(name => /shadow|uppercase|tracking|rounded-lg/.test(name))).toEqual([]);
    }
  });

  it('busy holds the button without disabling it: aria-disabled, aria-busy, its busy label and its focus', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<OccButton variant="primary" onClick={onClick}>Confirmar decisión</OccButton>);
    const button = screen.getByRole('button', { name: 'Confirmar decisión' });
    button.focus();
    rerender(<OccButton variant="primary" busy busyLabel="Confirmando…" onClick={onClick}>Confirmar decisión</OccButton>);
    // A browser moves the focus off a control that gets disabled, to the page, and the keyboard loses its place (the
    // Esc and the Tab of a dialog with it). So a busy button is disabled for assistive technology only, and stays
    // focused and focusable.
    expect(button).toHaveAccessibleName('Confirmando…');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).not.toBeDisabled();
    expect(button).toHaveFocus();
    // It keeps its look, with a waiting cursor and no hover.
    expect(classesOf(button)).toEqual(expect.arrayContaining(['bg-occ-primary', 'cursor-wait']));
    expect(classesOf(button)).not.toContain('hover:bg-occ-primary-hover');
    // A press, Enter or Space does nothing.
    await user.click(button);
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).not.toHaveBeenCalled();
    expect(button).toHaveFocus();

    // Without a busy label the children stay.
    rerender(<OccButton busy onClick={onClick}>Guardar</OccButton>);
    expect(screen.getByRole('button', { name: 'Guardar' })).toHaveAttribute('aria-busy', 'true');
    // Back at rest it acts, and aria-busy and aria-disabled are gone.
    rerender(<OccButton onClick={onClick}>Guardar</OccButton>);
    const idle = screen.getByRole('button', { name: 'Guardar' });
    expect(idle).not.toHaveAttribute('aria-busy');
    expect(idle).not.toHaveAttribute('aria-disabled');
    await user.click(idle);
    expect(onClick).toHaveBeenCalledOnce();

    // Busy wins over disabled: still held, never natively disabled, so it keeps the focus too.
    rerender(<OccButton busy disabled busyLabel="Exportando…" onClick={onClick}>Exportar CSV</OccButton>);
    const exporting = screen.getByRole('button', { name: 'Exportando…' });
    expect(exporting).toHaveAttribute('aria-disabled', 'true');
    expect(exporting).not.toBeDisabled();
    expect(exporting).toHaveFocus();
    await user.click(exporting);
    expect(onClick).toHaveBeenCalledOnce();

    // Disabled is the faint look, without hover.
    rerender(<OccButton variant="danger" disabled>Revocar</OccButton>);
    const disabled = screen.getByRole('button', { name: 'Revocar' });
    expect(disabled).toBeDisabled();
    expect(disabled).not.toHaveAttribute('aria-busy');
    expect(classesOf(disabled)).toEqual(expect.arrayContaining(['text-occ-faint', 'cursor-not-allowed']));
    expect(classesOf(disabled).filter(name => name.startsWith('hover:') || name === 'text-occ-danger')).toEqual([]);
  });

  it('a busy submit button sends no form, neither from a press nor from Enter in a field', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(event => event.preventDefault());
    const form = button => (
      <form aria-label="Nueva terminal" onSubmit={onSubmit}>
        <label>Código <input /></label>
        {button}
      </form>
    );
    const { rerender } = render(form(
      <OccButton type="submit" variant="primary" busy busyLabel="Creando…">Crear terminal</OccButton>,
    ));
    const submit = screen.getByRole('button', { name: 'Creando…' });
    expect(submit).toHaveAttribute('type', 'submit');
    await user.click(submit);
    // Enter in a field presses the form's submit button, which cancels that press too.
    await user.type(screen.getByRole('textbox', { name: 'Código' }), 'C{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();

    // At rest the same button sends the form.
    rerender(form(<OccButton type="submit" variant="primary">Crear terminal</OccButton>));
    await user.click(screen.getByRole('button', { name: 'Crear terminal' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('occButtonClass gives a link the same look', () => {
    render(<>
      <OccButton variant="primary">Planificar</OccButton>
      <a href="/admin-occ/planning" className={occButtonClass({ variant: 'primary' })}>Abrir planificación</a>
    </>);
    const button = classesOf(screen.getByRole('button', { name: 'Planificar' }));
    const link = classesOf(screen.getByRole('link', { name: 'Abrir planificación' }));
    expect(link).toEqual(button);
    // The defaults are the secondary button of medium size.
    expect(occButtonClass()).toBe(occButtonClass({ variant: 'secondary', size: 'md' }));
    expect(occButtonClass({ size: 'sm' }).split(' ')).toEqual(expect.arrayContaining(['h-7', 'border-occ-line-strong']));
  });

  it('throws on an unknown variant or size', () => {
    expect(() => occButtonClass({ variant: 'link' })).toThrow(RangeError);
    expect(() => occButtonClass({ size: 'lg' })).toThrow(/Unknown OCC button size: lg/);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<OccButton variant="accent">Guardar</OccButton>)).toThrow(/Unknown OCC button variant: accent/);
    } finally {
      consoleError.mockRestore();
    }
  });
});
