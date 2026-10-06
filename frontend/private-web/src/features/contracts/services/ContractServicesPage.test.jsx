import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContractServicesPage from './ContractServicesPage';
import { __resetContractServicesStoreForTests } from '../../../services/contractServicesService';

afterEach(() => __resetContractServicesStoreForTests());

describe('ContractServicesPage', () => {
  it('lists and filters services by contract', async () => {
    render(<ContractServicesPage />);
    expect(await screen.findByText('Puente de abordaje')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /filtrar por contrato/i }), 'CTR-2026-018');
    expect(screen.getByText('GPU')).toBeInTheDocument();
    expect(screen.queryByText('Limpieza de cabina')).not.toBeInTheDocument();
  });

  it('validates and creates a contractual service', async () => {
    render(<ContractServicesPage />);
    await screen.findByText('Puente de abordaje');
    await userEvent.click(screen.getByRole('button', { name: /agregar servicio/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Agregar servicio' }));
    expect(screen.getByText('Indica el servicio.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^Servicio/), 'Remolque');
    await userEvent.type(screen.getByLabelText(/^Tarifa/), '350');
    await userEvent.type(screen.getByLabelText(/^Inicio de vigencia/), '2026-08-10');
    await userEvent.type(screen.getByLabelText(/^Fin de vigencia/), '2027-02-28');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar servicio' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Remolque')).toBeInTheDocument();
  });
});