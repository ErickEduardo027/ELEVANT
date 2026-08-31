import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import EquipmentList from './EquipmentList';

describe('EquipmentList', () => {
  it('shows the empty copy when there is no equipment', () => {
    render(<EquipmentList equipment={[]} />);
    expect(screen.getByText('Sin equipos registrados.')).toBeInTheDocument();
  });

  it('highlights a row when reported/used differs from planned', () => {
    render(<EquipmentList equipment={[{ name: 'GPU', planned: 1, reported: 2, used: 2 }]} />);
    expect(screen.getByTestId('equipment-row')).toHaveClass('bg-status-warning/5');
  });

  it('does not highlight a row when planned, reported, and used all match', () => {
    render(<EquipmentList equipment={[{ name: 'GPU', planned: 1, reported: 1, used: 1 }]} />);
    expect(screen.getByTestId('equipment-row')).not.toHaveClass('bg-status-warning/5');
  });
});
