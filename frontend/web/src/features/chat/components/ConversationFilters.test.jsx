import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationFilters from './ConversationFilters';

describe('ConversationFilters', () => {
  it('renders every quick filter with counts and marks the active one', () => {
    render(<ConversationFilters active="unread" onChange={() => {}} counts={{ unread: 2, active: 3, pending: 1, closed: 1 }} />);

    expect(screen.getByRole('tab', { name: /No leídas/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /En curso/ })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('(2)')).toBeInTheDocument();
  });

  it('calls onChange with the clicked filter id', async () => {
    const onChange = vi.fn();
    render(<ConversationFilters active="all" onChange={onChange} counts={{}} />);

    await userEvent.click(screen.getByRole('tab', { name: /Cerradas/ }));
    expect(onChange).toHaveBeenCalledWith('closed');
  });
});
