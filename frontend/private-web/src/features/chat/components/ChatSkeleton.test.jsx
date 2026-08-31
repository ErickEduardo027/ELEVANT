import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatSkeleton from './ChatSkeleton';

describe('ChatSkeleton', () => {
  it('renders placeholder rows for the conversation list and the message thread', () => {
    render(<ChatSkeleton />);
    expect(screen.getByTestId('chat-skeleton')).toBeInTheDocument();
    expect(screen.getAllByTestId('conversation-skeleton-row')).toHaveLength(6);
    expect(screen.getAllByTestId('message-skeleton-row')).toHaveLength(4);
  });
});
