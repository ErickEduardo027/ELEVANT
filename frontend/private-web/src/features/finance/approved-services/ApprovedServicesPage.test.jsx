import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { resetApprovedServicesForTests } from '../../../services/approvedServicesService';
import ApprovedServicesPage from './ApprovedServicesPage';

afterEach(resetApprovedServicesForTests);

describe('ApprovedServicesPage', () => {
  it('filters by airline', async () => {
    render(<ApprovedServicesPage />);
    await screen.findAllByText('Puente de abordaje');
    fireEvent.change(screen.getByLabelText('Filtrar por aerolínea'), { target: { value: 'Arajet' } });
    expect(screen.getByText('DM 1763')).toBeInTheDocument();
    expect(screen.queryByText('AA 2401')).not.toBeInTheDocument();
  });
  it('marks a pending service as reviewed', async () => {
    render(<ApprovedServicesPage />);
    const buttons = await screen.findAllByRole('button', { name: 'Marcar revisado' });
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(screen.getAllByText('Revisado').length).toBeGreaterThan(2));
  });
});
