import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewActionBar from './ReviewActionBar';

describe('ReviewActionBar', () => {
  it('invokes the corresponding callback for each action', async () => {
    const onApproveClick = vi.fn();
    const onReturnClick = vi.fn();
    const onViewHistory = vi.fn();
    render(<ReviewActionBar onApproveClick={onApproveClick} onReturnClick={onReturnClick} onViewHistory={onViewHistory} />);

    await userEvent.click(screen.getByRole('button', { name: 'Aprobar' }));
    await userEvent.click(screen.getByRole('button', { name: /devolver con correcciones/i }));
    await userEvent.click(screen.getByRole('button', { name: /ver historial/i }));

    expect(onApproveClick).toHaveBeenCalledTimes(1);
    expect(onReturnClick).toHaveBeenCalledTimes(1);
    expect(onViewHistory).toHaveBeenCalledTimes(1);
  });
});