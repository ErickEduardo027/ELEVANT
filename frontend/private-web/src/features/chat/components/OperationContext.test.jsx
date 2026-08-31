import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OperationContext from './OperationContext';

const conversation = { flightNumber: 'DM161', position: 'A5', agentName: 'Carlos Medina', status: 'active' };

describe('OperationContext', () => {
  it('shows flight, position, agent and status by default', () => {
    render(<OperationContext conversation={conversation} />);
    expect(screen.getByText('DM161')).toBeInTheDocument();
    expect(screen.getByText('A5')).toBeInTheDocument();
    expect(screen.getByText('Carlos Medina')).toBeInTheDocument();
    expect(screen.getByText('En curso')).toBeInTheDocument();
  });

  it('falls back to "Sin asignar" when there is no position', () => {
    render(<OperationContext conversation={{ ...conversation, position: null }} />);
    expect(screen.getByText('Sin asignar')).toBeInTheDocument();
  });

  it('collapses and expands on toggle', async () => {
    render(<OperationContext conversation={conversation} />);
    const toggle = screen.getByRole('button', { name: /Contexto de la operación/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Carlos Medina')).not.toBeInTheDocument();

    await userEvent.click(toggle);
    expect(screen.getByText('Carlos Medina')).toBeInTheDocument();
  });
});
