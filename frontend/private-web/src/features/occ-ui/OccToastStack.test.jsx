import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import tailwindConfig from '../../../tailwind.config.js';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import OccToastStack, { OCC_TOAST_PLACEMENT, OccToastAnnouncer } from './OccToastStack';

const TOASTS = [
  { id: 'notice:a', priority: 'urgent', message: 'Incidencia reportada en rampa', code: 'OP-0412' },
  { id: 'notice:b', priority: 'attention', message: 'Desviación reportada en rampa', code: 'OP-0413' },
  { id: 'notice:c', priority: 'notice', message: 'Operación entregada para revisión', code: 'OP-0414' },
];

function stack(props) {
  return <LanguageScope><OccToastStack toasts={TOASTS} onDismiss={vi.fn()} {...props} /></LanguageScope>;
}

const classesOf = element => element.className.split(/\s+/);
// A Tailwind spacing class in px: one step of the default scale is 0.25 rem, 4 px.
const spacingPx = (classes, prefix) => Number(new RegExp(`^${prefix}-(\\d+)$`).exec(classes.find(name => name
  .startsWith(`${prefix}-`)) ?? '')?.[1]) * 4;

afterEach(() => {
  cleanup();
  resetLanguageForTests();
});

describe('OccToastStack', () => {
  it('urgent toasts are alerts and the rest are status', () => {
    render(stack());
    const [urgent] = screen.getAllByRole('alert');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(urgent).toHaveTextContent('Urgente');
    // «{tipo}, {código}», the code drawn as a plate so it never breaks across lines.
    expect(urgent).toHaveTextContent('Incidencia reportada en rampa, OP-0412');
    expect(within(urgent).getByText('OP-0412')).toHaveAttribute('data-occ-plate', 'code');
    expect(urgent.querySelector('[data-occ-glyph]')).toHaveAttribute('data-shape', 'octagon');
    expect(classesOf(urgent)).toEqual(expect.arrayContaining(['bg-occ-danger-soft', 'border-l-occ-danger']));

    const [attention, notice] = screen.getAllByRole('status');
    expect(screen.getAllByRole('status')).toHaveLength(2);
    expect(attention).toHaveTextContent('Atención');
    expect(attention.querySelector('[data-occ-glyph]')).toHaveAttribute('data-shape', 'triangle');
    expect(classesOf(attention)).toEqual(expect.arrayContaining(['bg-occ-warn-soft', 'border-l-occ-warn']));
    // A plain notice carries no hue.
    expect(notice).toHaveTextContent('Aviso');
    expect(notice.querySelector('[data-occ-glyph]')).toHaveAttribute('data-shape', 'diamond');
    expect(classesOf(notice).filter(name => /warn|danger/.test(name))).toEqual([]);

    // The glyph sits next to its word, so it is hidden from screen readers; nothing blinks in a toast.
    for (const glyph of document.querySelectorAll('[data-occ-glyph]')) {
      expect(glyph).toHaveAttribute('aria-hidden', 'true');
      expect(glyph.getAttribute('class')).not.toContain('animate-');
    }
    // A toast never takes focus.
    expect(document.body).toHaveFocus();
  });

  it('Abrir runs its action and dismisses the toast', async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    const viewAll = vi.fn();
    const onDismiss = vi.fn();
    render(stack({
      onDismiss,
      toasts: [
        { ...TOASTS[0], action: { label: 'Abrir', onClick: open } },
        { id: 'summary:d', priority: 'notice', message: 'Tienes 3 avisos operativos nuevos más.', code: null,
          action: { label: 'Ver', onClick: viewAll } },
      ],
    }));
    // A summary has no code, so no comma and no plate.
    expect(screen.getByRole('status').querySelector('[data-occ-plate]')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/nuevos más\.Ver/);
    const urgent = screen.getByRole('alert');
    await user.click(within(urgent).getByRole('button', { name: 'Abrir' }));
    expect(open).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith('notice:a');

    await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Ver' }));
    expect(viewAll).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenLastCalledWith('summary:d');

    // «Cerrar notificación» only closes it.
    onDismiss.mockClear();
    await user.click(within(urgent).getByRole('button', { name: 'Cerrar notificación' }));
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith('notice:a');
    expect(open).toHaveBeenCalledOnce();
  });

  it('sits under the status bar, never over the clocks or the alert count', () => {
    const { container } = render(stack());
    const root = container.querySelector('[data-occ-toasts]');
    const classes = classesOf(root);
    expect(classes).toEqual(expect.arrayContaining(OCC_TOAST_PLACEMENT.className.split(' ')));
    // Fixed to the screen's top right: 56 px from the top, 8 px under the 48 px bar, and 16 px from the right.
    expect(classes).toContain('fixed');
    expect(spacingPx(classes, 'top')).toBe(OCC_TOAST_PLACEMENT.topPx);
    expect(spacingPx(classes, 'right')).toBe(OCC_TOAST_PLACEMENT.rightPx);
    expect(OCC_TOAST_PLACEMENT.statusBarPx).toBe(48);
    expect(OCC_TOAST_PLACEMENT.topPx - OCC_TOAST_PLACEMENT.statusBarPx).toBe(8);
    // Above the bar's layer, the drawers and the dialogs.
    const { zIndex } = tailwindConfig.theme.extend;
    expect(classes).toContain('z-toast');
    for (const layer of ['nav', 'overlay', 'drawer', 'modal']) expect(Number(zIndex.toast)).toBeGreaterThan(Number(zIndex[layer]));
  });

  it('speaks English inside a translated scope and renders nothing without toasts', () => {
    resetLanguageForTests('en');
    const view = render(stack());
    expect(screen.getByRole('alert')).toHaveTextContent('Urgent');
    expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Close notification' })).toBeInTheDocument();
    view.rerender(stack({ toasts: [] }));
    expect(document.querySelector('[data-occ-toasts]')).toBeNull();
  });
});

describe('OccToastAnnouncer', () => {
  const announcer = props => <LanguageScope><OccToastAnnouncer toasts={TOASTS} {...props} /></LanguageScope>;
  // What each toast says, and as what: an alert or a status.
  const spoken = root => [...root.querySelectorAll('[role]')].map(item => [item.getAttribute('role'), item.textContent]);

  it('reads the toasts out with the words of the stack, an urgent one as an alert, and draws nothing', () => {
    const view = render(announcer());
    const root = document.querySelector('[data-occ-toast-announcer]');
    // Out of sight and with no control: inside a drawer it covers nothing and adds no stop for Tab.
    expect(classesOf(root)).toContain('sr-only');
    expect(within(root).queryAllByRole('button')).toEqual([]);
    expect(root.querySelector('[data-occ-glyph]')).toBeNull();
    expect(document.querySelector('[data-occ-toasts]')).toBeNull();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getAllByRole('status')).toHaveLength(2);
    const said = spoken(root);
    expect(said[0]).toEqual(['alert', 'UrgenteIncidencia reportada en rampa, OP-0412']);
    view.unmount();

    // The stack says the same words, in the same roles.
    render(stack());
    expect(spoken(document.querySelector('[data-occ-toasts]'))).toEqual(said);
  });

  it('speaks English, reads an unknown priority as a notice and says nothing without toasts', () => {
    resetLanguageForTests('en');
    const view = render(announcer({
      toasts: [{ id: 'summary:z', priority: 'unknown', message: 'You have 3 more new operational notices.', code: null }],
    }));
    const root = document.querySelector('[data-occ-toast-announcer]');
    expect(spoken(root)).toEqual([['status', 'NoticeYou have 3 more new operational notices.']]);
    view.rerender(announcer({ toasts: [] }));
    expect(spoken(document.querySelector('[data-occ-toast-announcer]'))).toEqual([]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
