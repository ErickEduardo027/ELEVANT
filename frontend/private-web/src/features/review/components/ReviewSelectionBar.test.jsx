import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewSelectionBar from './ReviewSelectionBar';

describe('ReviewSelectionBar', () => {
  it('renders nothing when count is zero', () => {
    const { container } = render(
      <ReviewSelectionBar count={0} onApproveSelected={() => {}} onReturnSelected={() => {}} onClearSelection={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the selected count in singular and plural form', () => {
    const { rerender } = render(
      <ReviewSelectionBar count={1} onApproveSelected={() => {}} onReturnSelected={() => {}} onClearSelection={() => {}} />
    );
    expect(screen.getByText('1 operación seleccionada')).toBeInTheDocument();

    rerender(<ReviewSelectionBar count={3} onApproveSelected={() => {}} onReturnSelected={() => {}} onClearSelection={() => {}} />);
    expect(screen.getByText('3 operaciones seleccionadas')).toBeInTheDocument();
  });

  it('invokes the corresponding callback for each action', async () => {
    const onApproveSelected = vi.fn();
    const onReturnSelected = vi.fn();
    const onClearSelection = vi.fn();
    render(
      <ReviewSelectionBar count={2} onApproveSelected={onApproveSelected} onReturnSelected={onReturnSelected} onClearSelection={onClearSelection} />
    );

    await userEvent.click(screen.getByRole('button', { name: /aprobar seleccionadas/i }));
    await userEvent.click(screen.getByRole('button', { name: /devolver seleccionadas/i }));
    await userEvent.click(screen.getByRole('button', { name: /limpiar selección/i }));

    expect(onApproveSelected).toHaveBeenCalledTimes(1);
    expect(onReturnSelected).toHaveBeenCalledTimes(1);
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });
});