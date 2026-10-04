import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContractRequestsPage from './ContractRequestsPage';
import { __resetContractRequestsStoreForTests } from '../../../services/contractRequestsService';

afterEach(() => __resetContractRequestsStoreForTests());

describe('ContractRequestsPage', () => {
  it('lists and filters received requests', async () => {
    render(<ContractRequestsPage />);
    expect(await screen.findByText('SOL-108')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /filtrar por tipo/i }), 'affiliation');
    expect(screen.getByText('SOL-107')).toBeInTheDocument();
    expect(screen.queryByText('SOL-108')).not.toBeInTheDocument();
  });

  it('moves a pending request into review', async () => {
    render(<ContractRequestsPage />);
    await screen.findByText('SOL-108');
    await userEvent.click(screen.getAllByRole('button', { name: 'Revisar' })[0]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /marcar en revisión/i }));
    await waitFor(() => expect(screen.getAllByText(/en revisión/i).length).toBeGreaterThan(1));
  });

  it('requires an observation and records a decision', async () => {
    render(<ContractRequestsPage />);
    await screen.findByText('SOL-107');
    await userEvent.click(screen.getAllByRole('button', { name: 'Revisar' })[1]);
    await userEvent.click(screen.getByRole('button', { name: /atender y notificar/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/registra una observación/i);
    await userEvent.type(screen.getByLabelText(/observación para el solicitante/i), 'Afiliación aprobada para continuar el proceso.');
    await userEvent.click(screen.getByRole('button', { name: /atender y notificar/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getAllByText('Aprobada').length).toBeGreaterThan(1);
  });
});