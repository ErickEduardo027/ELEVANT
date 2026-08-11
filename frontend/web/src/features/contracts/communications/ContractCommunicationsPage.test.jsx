import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContractCommunicationsPage from './ContractCommunicationsPage';
import { __resetContractCommunicationsForTests } from '../../../services/contractCommunicationsService';

afterEach(() => __resetContractCommunicationsForTests());

describe('ContractCommunicationsPage', () => {
  it('shows conversations linked to contractual context', async () => {
    render(<ContractCommunicationsPage />);
    expect(await screen.findByText('CTR-2026-018 · Arajet')).toBeInTheDocument();
    expect(screen.getByText(/confirma si el servicio gpu/i)).toBeInTheDocument();
  });

  it('filters conversations and sends a message', async () => {
    render(<ContractCommunicationsPage />);
    await screen.findByText('CTR-2026-018 · Arajet');
    await userEvent.type(screen.getByRole('searchbox'), 'José Ramírez');
    await userEvent.click(screen.getByRole('button', { name: /agente de rampa · josé ramírez/i }));
    await userEvent.type(screen.getByLabelText('Mensaje'), 'Condición contractual confirmada.');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('Condición contractual confirmada.')).toBeInTheDocument();
  });
});
