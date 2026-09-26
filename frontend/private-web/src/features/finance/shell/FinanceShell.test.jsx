import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import FinanceShell from './FinanceShell';

describe('FinanceShell', () => {
  it('opens an explicitly synthetic home without offering an unimplemented notification feed', async () => {
    render(<FinanceShell />);
    expect(await screen.findByRole('heading', { name: 'Resumen financiero' })).toBeInTheDocument();
    expect(screen.getByText(/Datos sintéticos · solo lectura/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Notificaciones' })).not.toBeInTheDocument();
  });
});
