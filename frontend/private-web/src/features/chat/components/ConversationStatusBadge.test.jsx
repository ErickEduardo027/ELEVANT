import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ConversationStatusBadge from './ConversationStatusBadge';

describe('ConversationStatusBadge', () => {
  it('renders the label for each conversation status', () => {
    render(<ConversationStatusBadge status="active" />);
    expect(screen.getByText('En curso')).toBeInTheDocument();
  });

  it('renders the pending and closed labels', () => {
    const { rerender } = render(<ConversationStatusBadge status="pending" />);
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
    rerender(<ConversationStatusBadge status="closed" />);
    expect(screen.getByText('Cerrada')).toBeInTheDocument();
  });
});