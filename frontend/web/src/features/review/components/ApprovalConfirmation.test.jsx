import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ApprovalConfirmation from './ApprovalConfirmation';

describe('ApprovalConfirmation', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<ApprovalConfirmation open={false} onConfirm={() => {}} onCancel={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the single-operation copy for a single approval', () => {
    render(<ApprovalConfirmation open count={1} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/confirme que la operación ha sido revisada/i)).toBeInTheDocument();
  });

  it('shows the explicit bulk-approval warning for multiple operations', () => {
    render(<ApprovalConfirmation open count={3} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/está a punto de aprobar 3 operaciones/i)).toBeInTheDocument();
    expect(screen.getByText(/no podrá deshacer esta acción/i)).toBeInTheDocument();
  });

  it('calls onConfirm and onCancel from their respective buttons', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ApprovalConfirmation open count={1} onConfirm={onConfirm} onCancel={onCancel} />);

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
