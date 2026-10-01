import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import FinanceShell from './FinanceShell';

describe('FinanceShell', () => {
  it('does not show invented finance data or an unimplemented notification feed', async () => {
    render(<FinanceShell />);
    expect(await screen.findByRole('heading', { name: 'Resumen financiero' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('No hay una estación financiera autorizada');
    expect(screen.queryByText(/Datos sintéticos/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Notificaciones' })).not.toBeInTheDocument();
  });

  it('does not expose deferred prototype departmental chat', async () => {
    render(<FinanceShell />);
    expect(await screen.findByRole('heading', { name: 'Resumen financiero' })).toBeInTheDocument();
    expect(screen.getByRole('navigation')).not.toHaveTextContent('Comunicaciones');
  });
});
