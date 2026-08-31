import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import BarChart from './BarChart';

describe('BarChart', () => {
  it('renders a title and a bar per data point in vertical orientation', () => {
    render(<BarChart title="Vuelos por período" data={[{ label: '01 AGO', value: 4 }, { label: '02 AGO', value: 9 }]} />);
    expect(screen.getByText('Vuelos por período')).toBeInTheDocument();
    expect(screen.getAllByTestId('bar-chart-bar')).toHaveLength(2);
    expect(screen.getByText('01 AGO')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('renders horizontal bars with the exact value alongside each label, and a hover tooltip', () => {
    render(<BarChart title="Servicios por tipo" data={[{ label: 'GPU', value: 6 }]} orientation="horizontal" />);
    expect(screen.getByText('GPU')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByTitle('GPU: 6')).toBeInTheDocument();
  });

  it('shows an empty message when there is no data', () => {
    render(<BarChart title="Sin datos" data={[]} />);
    expect(screen.getByText('Sin datos para el período seleccionado.')).toBeInTheDocument();
  });
});
