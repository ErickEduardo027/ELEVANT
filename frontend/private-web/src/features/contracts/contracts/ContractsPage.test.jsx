import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContractsPage from './ContractsPage';
import { __resetContractsStoreForTests } from '../../../services/contractsService';

afterEach(() => __resetContractsStoreForTests());

describe('ContractsPage', () => {
  it('lists contracts and filters by search and status', async () => {
    render(<ContractsPage />);
    expect(await screen.findByText('CTR-2026-018')).toBeInTheDocument();
    const search = screen.getByRole('searchbox');
    await userEvent.type(search, 'Arajet');
    expect(screen.getByText('CTR-2026-018')).toBeInTheDocument();
    expect(screen.queryByText('CTR-2026-014')).not.toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.selectOptions(screen.getByRole('combobox'), 'disabled');
    expect(screen.getByText('CTR-2025-002')).toBeInTheDocument();
  });

  it('validates and registers a new contract', async () => {
    render(<ContractsPage />);
    await screen.findByText('CTR-2026-018');
    await userEvent.click(screen.getByRole('button', { name: /registrar contrato/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Registrar contrato' }));
    expect(screen.getByText('Indique la aerolínea.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^Aerolínea/), 'Nueva Aerolínea');
    await userEvent.type(screen.getByLabelText(/^Código IATA/), 'NA');
    await userEvent.type(screen.getByLabelText(/^Inicio de vigencia/), '2026-08-10');
    await userEvent.type(screen.getByLabelText(/^Fin de vigencia/), '2027-08-09');
    await userEvent.type(screen.getByLabelText(/^Condiciones operativas/), 'Servicios de asistencia acordados.');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar contrato' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Nueva Aerolínea')).toBeInTheDocument();
  });

  it('updates an existing contract', async () => {
    render(<ContractsPage />);
    await screen.findByText('CTR-2026-018');
    await userEvent.click(screen.getAllByRole('button', { name: /ver \/ actualizar/i })[0]);
    const conditions = screen.getByLabelText('Condiciones operativas');
    await userEvent.clear(conditions);
    await userEvent.type(conditions, 'Condiciones actualizadas para PUJ.');
    await userEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});