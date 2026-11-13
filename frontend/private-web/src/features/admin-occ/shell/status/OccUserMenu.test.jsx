import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../../i18n/languageStore';
import OccUserMenu from './OccUserMenu';

const USER = { name: 'Alex Operations', role: 'Administrador / OCC' };

function menu(props) {
  return <LanguageScope><OccUserMenu user={USER} onLogout={vi.fn()} {...props} /></LanguageScope>;
}

afterEach(() => {
  cleanup();
  resetLanguageForTests();
  window.localStorage.clear();
});

describe('OccUserMenu', () => {
  it('shows name, role and Cerrar sesión and calls onLogout', async () => {
    const onLogout = vi.fn();
    render(menu({ onLogout }));
    const button = screen.getByRole('button', { name: 'Menú de Alex Operations' });
    expect(button).toHaveTextContent(/^AO$/);
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    // A plate of initials on the raised slab, with the strong joint every control boundary uses (design H.2).
    expect(button.className.split(/\s+/)).toEqual(expect.arrayContaining(['bg-occ-panel-raised', 'border-occ-line-strong']));

    await userEvent.click(button);
    const panel = screen.getByRole('dialog', { name: 'Menú de Alex Operations' });
    expect(within(panel).getByText('Alex Operations')).toBeInTheDocument();
    expect(within(panel).getByText('Administrador / OCC')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Cerrar sesión' }));
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Esc and returns focus', async () => {
    render(menu());
    const button = screen.getByRole('button', { name: 'Menú de Alex Operations' });
    await userEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Menú de Alex Operations' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('holds Leyenda and the language below 1024 px, mounted only while open so no name appears twice', async () => {
    render(menu());
    expect(screen.queryByRole('button', { name: 'Leyenda' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Idioma' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Menú de Alex Operations' }));
    const panel = screen.getByRole('dialog', { name: 'Menú de Alex Operations' });
    const legend = within(panel).getByRole('button', { name: 'Leyenda' });
    const language = within(panel).getByRole('group', { name: 'Idioma' });
    // From 1024 px the bar has its own, so these hide there.
    expect(legend.parentElement.className.split(/\s+/)).toContain('lg:hidden');
    expect(language.className.split(/\s+/)).toContain('lg:hidden');

    // The legend opens over the menu, fixed to the screen from 640 px so the menu's scrolling panel cannot clip it,
    // and one Esc closes only the legend.
    await userEvent.click(legend);
    const legendPanel = screen.getByRole('dialog', { name: 'Leyenda' });
    expect(legendPanel.className.split(/\s+/)).toEqual(expect.arrayContaining(['sm:fixed', 'sm:right-2', 'sm:top-12']));
    expect(panel.className.split(/\s+/)).not.toContain('sm:fixed');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Leyenda' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Menú de Alex Operations' })).toBeInTheDocument();

    // The language switches from the menu as well.
    await userEvent.click(within(language).getByRole('button', { name: 'English' }));
    expect(screen.getByRole('dialog', { name: 'Alex Operations menu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('offers no sign-out without a handler', async () => {
    render(menu({ onLogout: undefined }));
    await userEvent.click(screen.getByRole('button', { name: 'Menú de Alex Operations' }));
    expect(screen.queryByRole('button', { name: 'Cerrar sesión' })).not.toBeInTheDocument();
  });
});
