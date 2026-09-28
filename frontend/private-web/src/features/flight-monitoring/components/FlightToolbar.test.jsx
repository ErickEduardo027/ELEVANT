import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightToolbar from './FlightToolbar';

const OPTIONS = {
  dates: ['2026-08-06'],
  airlines: ['Arajet', 'American'],
  statuses: ['approaching', 'delayed'],
  origins: ['MIA', 'PUJ'],
  destinations: ['MIA', 'PUJ'],
};

const FILTERS = { date: '', airline: '', status: '', origin: '', destination: '', search: '' };

describe('FlightToolbar', () => {
  it('renders the connection status and every filter dropdown', () => {
    render(
      <FlightToolbar
        connection="connected"
        lastUpdatedAt={null}
        onRefresh={() => {}}
        filters={FILTERS}
        onFilterChange={() => {}}
        options={OPTIONS}
        onlyStationRelated={false}
        onToggleStationRelated={() => {}}
      />
    );
    expect(screen.getByText('FlyAware conectado')).toBeInTheDocument();
    expect(screen.getByLabelText('Fecha')).toBeInTheDocument();
    expect(screen.getByLabelText('Aerolínea')).toBeInTheDocument();
    expect(screen.getByLabelText('Estado')).toBeInTheDocument();
    expect(screen.getByLabelText('Origen')).toBeInTheDocument();
    expect(screen.getByLabelText('Destino')).toBeInTheDocument();
  });

  it('labels the station filter with the selected station, never a fixed airport', () => {
    render(<FlightToolbar stationCode="SDQ" connection="connected" lastUpdatedAt={null}
      onRefresh={() => {}} filters={FILTERS} onFilterChange={() => {}}
      options={OPTIONS} onlyStationRelated={false} onToggleStationRelated={() => {}} />);
    expect(screen.getByText('Solo vuelos relacionados con SDQ')).toBeInTheDocument();
    expect(screen.queryByText('Solo vuelos relacionados con PUJ')).not.toBeInTheDocument();
  });

  it('does not render a search box (that lives in FlightListPanel)', () => {
    render(
      <FlightToolbar
        connection="connected"
        lastUpdatedAt={null}
        onRefresh={() => {}}
        filters={FILTERS}
        onFilterChange={() => {}}
        options={OPTIONS}
        onlyStationRelated={false}
        onToggleStationRelated={() => {}}
      />
    );
    expect(screen.queryByPlaceholderText('Número, aerolínea, matrícula o supervisor')).not.toBeInTheDocument();
  });

  it('formats status options through getStatusMeta labels', () => {
    render(
      <FlightToolbar
        connection="connected"
        lastUpdatedAt={null}
        onRefresh={() => {}}
        filters={FILTERS}
        onFilterChange={() => {}}
        options={OPTIONS}
        onlyStationRelated={false}
        onToggleStationRelated={() => {}}
      />
    );
    expect(screen.getByRole('option', { name: 'Aproximando' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Retrasado' })).toBeInTheDocument();
  });

  it('calls onFilterChange with the field key when a dropdown changes', async () => {
    const onFilterChange = vi.fn();
    render(
      <FlightToolbar
        connection="connected"
        lastUpdatedAt={null}
        onRefresh={() => {}}
        filters={FILTERS}
        onFilterChange={onFilterChange}
        options={OPTIONS}
        onlyStationRelated={false}
        onToggleStationRelated={() => {}}
      />
    );
    await userEvent.selectOptions(screen.getByLabelText('Aerolínea'), 'Arajet');
    expect(onFilterChange).toHaveBeenCalledWith('airline', 'Arajet');
  });

  it('toggles the "only PUJ" switch', async () => {
    const onToggleStationRelated = vi.fn();
    render(
      <FlightToolbar
        connection="connected"
        lastUpdatedAt={null}
        onRefresh={() => {}}
        filters={FILTERS}
        onFilterChange={() => {}}
        options={OPTIONS}
        onlyStationRelated={false}
        onToggleStationRelated={onToggleStationRelated}
      />
    );
    await userEvent.click(screen.getByRole('switch'));
    expect(onToggleStationRelated).toHaveBeenCalledWith(true);
  });
});
