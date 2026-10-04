import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReturnCorrectionModal from './ReturnCorrectionModal';

describe('ReturnCorrectionModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<ReturnCorrectionModal open={false} onConfirm={() => {}} onCancel={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps Confirmar disabled until a reason is entered', async () => {
    render(<ReturnCorrectionModal open onConfirm={() => {}} onCancel={() => {}} />);
    const confirmButton = screen.getByRole('button', { name: 'Confirmar' });
    expect(confirmButton).toBeDisabled();

    await userEvent.type(
      screen.getByPlaceholderText('Indique qué información debe corregirse o completarse.'),
      'Falta evidencia de cierre.'
    );
    expect(confirmButton).not.toBeDisabled();
  });

  it('calls onConfirm with the trimmed reason and does not submit an empty one', async () => {
    const onConfirm = vi.fn();
    render(<ReturnCorrectionModal open onConfirm={onConfirm} onCancel={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(onConfirm).not.toHaveBeenCalled();

    await userEvent.type(
      screen.getByPlaceholderText('Indique qué información debe corregirse o completarse.'),
      '  Falta la firma del supervisor.  '
    );
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(onConfirm).toHaveBeenCalledWith('Falta la firma del supervisor.');
  });

  it('shows the operation count when returning multiple operations', () => {
    render(<ReturnCorrectionModal open count={3} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/devolver con correcciones \(3 operaciones\)/i)).toBeInTheDocument();
  });

  it('calls onCancel and clears the reason', async () => {
    const onCancel = vi.fn();
    render(<ReturnCorrectionModal open onConfirm={() => {}} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});