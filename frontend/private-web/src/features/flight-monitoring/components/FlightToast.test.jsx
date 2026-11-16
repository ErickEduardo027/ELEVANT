import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightToastStack from './FlightToast';

describe('FlightToastStack', () => {
  it('renders nothing when there are no toasts', () => {
    const { container } = render(<FlightToastStack toasts={[]} onDismiss={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders every toast message', () => {
    render(
      <FlightToastStack
        toasts={[
          { id: 't1', kind: 'delayed', message: 'Vuelo DM161 cambió su ETA' },
          { id: 't2', kind: 'cancelled', message: 'Vuelo AA904 cancelado' },
        ]}
        onDismiss={() => {}}
      />
    );
    expect(screen.getByText('Vuelo DM161 cambió su ETA')).toBeInTheDocument();
    expect(screen.getByText('Vuelo AA904 cancelado')).toBeInTheDocument();
  });

  it('calls onDismiss with the toast id when its dismiss button is clicked', async () => {
    const onDismiss = vi.fn();
    render(
      <FlightToastStack toasts={[{ id: 't1', kind: 'delayed', message: 'Vuelo DM161 cambió su ETA' }]} onDismiss={onDismiss} />
    );
    await userEvent.click(screen.getByLabelText('Descartar aviso'));
    expect(onDismiss).toHaveBeenCalledWith('t1');
  });
});