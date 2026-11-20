import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Toast from './Toast';

describe('Toast', () => {
  it('announces failures assertively and informational outcomes politely', () => {
    render(
      <Toast
        toasts={[
          { id: 'danger', tone: 'danger', message: 'Resultado incierto.' },
          { id: 'success', tone: 'success', message: 'Asignación confirmada.' },
        ]}
        onDismiss={() => {}}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Resultado incierto.');
    expect(screen.getByRole('status')).toHaveTextContent('Asignación confirmada.');
  });

  it('dismisses the selected notification', async () => {
    const onDismiss = vi.fn();
    render(
      <Toast
        toasts={[{ id: 'toast-1', tone: 'success', message: 'Listo.' }]}
        onDismiss={onDismiss}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar notificación' }));
    expect(onDismiss).toHaveBeenCalledWith('toast-1');
  });

  it('sits at the top right by default and at the bottom right when asked (D-N33)', () => {
    const toasts = [{ id: 'toast-1', tone: 'info', message: 'Nueva solicitud comercial.' }];
    const classesOf = element => element.className.split(/\s+/);
    const view = render(<Toast toasts={toasts} onDismiss={() => {}} />);
    const top = screen.getByRole('status').closest('[data-placement]');
    expect(top).toHaveAttribute('data-placement', 'top-right');
    expect(classesOf(top)).toEqual(expect.arrayContaining(['fixed', 'top-4', 'z-toast', 'sm:left-auto']));
    expect(classesOf(top).some(name => name.startsWith('bottom-'))).toBe(false);

    view.rerender(<Toast toasts={toasts} onDismiss={() => {}} placement="bottom-right" />);
    const bottom = screen.getByRole('status').closest('[data-placement]');
    expect(bottom).toHaveAttribute('data-placement', 'bottom-right');
    expect(classesOf(bottom)).toEqual(expect.arrayContaining(['fixed', 'bottom-4', 'z-toast', 'sm:left-auto']));
    // Nothing at the top, where the bell and the user menu of a department shell live.
    expect(classesOf(bottom).some(name => name.startsWith('top-'))).toBe(false);
    expect(screen.getByRole('status')).toHaveTextContent('Nueva solicitud comercial.');
  });

  it('keeps the default corner for an unknown placement', () => {
    render(<Toast toasts={[{ id: 'toast-1', tone: 'success', message: 'Listo.' }]} onDismiss={() => {}} placement="center" />);
    expect(screen.getByRole('status').closest('[data-placement]')).toHaveAttribute('data-placement', 'top-right');
  });
});