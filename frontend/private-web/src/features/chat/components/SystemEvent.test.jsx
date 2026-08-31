import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import SystemEvent from './SystemEvent';

describe('SystemEvent', () => {
  it('renders the event content and time as a discrete pill', () => {
    render(<SystemEvent message={{ content: 'La operación cambió a estado En ejecución.', createdAt: '2026-08-08T09:02:00-04:00' }} />);
    expect(screen.getByTestId('system-event')).toHaveTextContent('La operación cambió a estado En ejecución.');
  });
});
