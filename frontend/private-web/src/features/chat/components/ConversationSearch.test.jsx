import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConversationSearch from './ConversationSearch';

describe('ConversationSearch', () => {
  it('renders the current value and reports changes as the user types', async () => {
    const onChange = vi.fn();
    render(<ConversationSearch value="" onChange={onChange} />);

    const input = screen.getByPlaceholderText('Vuelo, aerolínea, agente, referencia...');
    await userEvent.type(input, 'DM');
    expect(onChange).toHaveBeenCalledWith('D');
    expect(onChange).toHaveBeenCalledWith('M');
  });
});
