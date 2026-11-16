import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationBulkActionsBar from './NotificationBulkActionsBar';

describe('NotificationBulkActionsBar', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(
      <NotificationBulkActionsBar count={0} onMarkRead={() => {}} onMarkUnread={() => {}} onClear={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the count and wires the three actions', async () => {
    const onMarkRead = vi.fn();
    const onMarkUnread = vi.fn();
    const onClear = vi.fn();
    render(<NotificationBulkActionsBar count={4} onMarkRead={onMarkRead} onMarkUnread={onMarkUnread} onClear={onClear} />);

    expect(screen.getByText('4 seleccionadas')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /marcar como leídas/i }));
    expect(onMarkRead).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: /marcar como no leídas/i }));
    expect(onMarkUnread).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: /limpiar selección/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('uses singular copy for a single selection', () => {
    render(<NotificationBulkActionsBar count={1} onMarkRead={() => {}} onMarkUnread={() => {}} onClear={() => {}} />);
    expect(screen.getByText('1 seleccionada')).toBeInTheDocument();
  });
});