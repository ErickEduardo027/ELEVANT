import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { resetPreinvoicesForTests } from '../../../services/preinvoiceService';
import PreinvoicesPage from './PreinvoicesPage';
afterEach(resetPreinvoicesForTests);
describe('PreinvoicesPage', () => {
  it('generates and saves a preinvoice', async () => { render(<PreinvoicesPage />); await screen.findByText('PRE-2026-082'); fireEvent.change(screen.getByLabelText('Aerolínea'), { target: { value: 'JetBlue' } }); fireEvent.click(screen.getByRole('button', { name: 'Generar pre-factura' })); expect(await screen.findByText('Pre-factura generada y guardada para revisión.')).toBeInTheDocument(); });
});
