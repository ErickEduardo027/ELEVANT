import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightListDrawer from './FlightListDrawer';

describe('FlightListDrawer', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <FlightListDrawer open={false} onClose={() => {}}>
        <p>contenido</p>
      </FlightListDrawer>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders its children and a backdrop when open', () => {
    render(
      <FlightListDrawer open onClose={() => {}}>
        <p>contenido</p>
      </FlightListDrawer>
    );
    expect(screen.getByText('contenido')).toBeInTheDocument();
    expect(screen.getByTestId('flight-list-drawer-backdrop')).toBeInTheDocument();
  });

  it('calls onClose when the backdrop is clicked', async () => {
    const onClose = vi.fn();
    render(
      <FlightListDrawer open onClose={onClose}>
        <p>contenido</p>
      </FlightListDrawer>
    );
    await userEvent.click(screen.getByTestId('flight-list-drawer-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});