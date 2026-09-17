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
});
