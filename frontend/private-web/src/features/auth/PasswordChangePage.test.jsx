import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PasswordChangePage from './PasswordChangePage';

describe('PasswordChangePage', () => {
  it('requires matching confirmation and submits secrets only after validation', async () => {
    const user = userEvent.setup();
    const submit = vi.fn().mockResolvedValue(undefined);
    render(<PasswordChangePage email="contratos@dev.elevant.test" onSubmit={submit} onCancel={() => {}} />);

    await user.type(screen.getByLabelText('Contraseña temporal'), 'Temporary-Development!2026');
    await user.type(screen.getByLabelText('Nueva contraseña'), 'New-Development-Password!2026');
    await user.type(screen.getByLabelText('Confirmar nueva contraseña'), 'Different-Development!2026');
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(screen.getByRole('alert')).toHaveTextContent('La confirmación no coincide');
    expect(submit).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('Confirmar nueva contraseña'));
    await user.type(screen.getByLabelText('Confirmar nueva contraseña'), 'New-Development-Password!2026');
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(submit).toHaveBeenCalledWith({
      email: 'contratos@dev.elevant.test',
      currentPassword: 'Temporary-Development!2026',
      newPassword: 'New-Development-Password!2026',
    });
  });
});
