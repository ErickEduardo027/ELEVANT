import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContractReportsPage from './ContractReportsPage';

describe('ContractReportsPage', () => {
  it('shows indicators and filters the report by airline', async () => {
    render(<ContractReportsPage />);
    expect(await screen.findByText('Servicios por aerolínea')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Aerolínea'), 'Arajet');
    expect(screen.getAllByText('Arajet').length).toBeGreaterThan(0);
    expect(within(screen.getByRole('table')).queryByText('Delta Air Lines')).not.toBeInTheDocument();
  });

  it('registers the direct PDF export', async () => {
    render(<ContractReportsPage />);
    await screen.findByText('Servicios por aerolínea');
    await userEvent.click(screen.getByRole('button', { name: /exportar pdf/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/exportación pdf registrada/i);
  });
});