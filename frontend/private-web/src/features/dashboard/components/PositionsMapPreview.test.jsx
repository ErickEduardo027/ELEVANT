import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PositionsMapPreview from './PositionsMapPreview';
import { RAMP_POSITIONS } from '../positionsData';

describe('PositionsMapPreview', () => {
  it('renders a schematic svg preview of the ramp', () => {
    render(<PositionsMapPreview onOpenMap={() => {}} />);
    expect(screen.getByRole('img', { name: /esquema simplificado de posiciones/i })).toBeInTheDocument();
  });

  it('renders one marker per known ramp position', () => {
    render(<PositionsMapPreview onOpenMap={() => {}} />);
    expect(screen.getAllByTestId('position-marker')).toHaveLength(RAMP_POSITIONS.length);
  });

  it('calls onOpenMap when the button is clicked', async () => {
    const onOpenMap = vi.fn();
    render(<PositionsMapPreview onOpenMap={onOpenMap} />);
    await userEvent.click(screen.getByRole('button', { name: /ver mapa completo/i }));
    expect(onOpenMap).toHaveBeenCalledTimes(1);
  });
});