import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewConversationDrawer from './NewConversationDrawer';

const OPTIONS = [
  { flightId: 6, flightNumber: 'AC1876', airline: 'Air Canada', origin: 'PUJ', destination: 'YYZ', position: 'A5', operationId: 'REV-1004', agentId: 12, agentName: 'Carlos Medina' },
  { flightId: 8, flightNumber: 'WG654', airline: 'Sunwing', origin: 'PUJ', destination: 'YYZ', position: 'B32', operationId: 'REV-1010', agentId: 8, agentName: 'María Castillo' },
];

describe('NewConversationDrawer', () => {
  it('renders nothing when closed', () => {
    render(<NewConversationDrawer open={false} options={OPTIONS} onCreate={() => {}} onClose={() => {}} />);
    expect(screen.queryByTestId('new-conversation-drawer')).not.toBeInTheDocument();
  });

  it('disables "Iniciar conversación" until a flight is selected, then enables it', async () => {
    render(<NewConversationDrawer open options={OPTIONS} onCreate={() => {}} onClose={() => {}} />);
    const submit = screen.getByRole('button', { name: 'Iniciar conversación' });
    expect(submit).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText('Vuelo / operación'), '6');
    expect(submit).toBeEnabled();
    expect(screen.getByText('REV-1004')).toBeInTheDocument();
    expect(screen.getByText('Carlos Medina')).toBeInTheDocument();
  });

  it('calls onCreate with the selected flight option', async () => {
    const onCreate = vi.fn();
    render(<NewConversationDrawer open options={OPTIONS} onCreate={onCreate} onClose={() => {}} />);

    await userEvent.selectOptions(screen.getByLabelText('Vuelo / operación'), '8');
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar conversación' }));

    expect(onCreate).toHaveBeenCalledWith(OPTIONS[1]);
  });

  it('shows an empty-options message when there is nothing available', () => {
    render(<NewConversationDrawer open options={[]} onCreate={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/No hay vuelos\/operaciones disponibles/)).toBeInTheDocument();
  });

  it('calls onClose from the close button', async () => {
    const onClose = vi.fn();
    render(<NewConversationDrawer open options={OPTIONS} onCreate={() => {}} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText('Cerrar'));
    expect(onClose).toHaveBeenCalled();
  });
});
