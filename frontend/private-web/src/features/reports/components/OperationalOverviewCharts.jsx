import FlightStatusChart from '../../dashboard/components/FlightStatusChart';
import BarChart from './BarChart';
import {
  buildAgentWorkloadChart,
  buildFlightStatusDistribution,
  buildFlightsByPeriodChart,
  buildServicesByTypeChart,
} from '../reportsMappers';

export default function OperationalOverviewCharts({ records }) {
  const flightsByPeriod = buildFlightsByPeriodChart(records);
  const flightStatusDistribution = buildFlightStatusDistribution(records);
  const servicesByType = buildServicesByTypeChart(records);
  const agentWorkload = buildAgentWorkloadChart(records);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <BarChart title="Vuelos atendidos por período" data={flightsByPeriod} orientation="vertical" />
      <FlightStatusChart distribution={flightStatusDistribution} />
      <BarChart title="Servicios ejecutados por tipo" data={servicesByType} orientation="horizontal" />
      <BarChart title="Carga operativa por agente" data={agentWorkload} orientation="horizontal" />
    </div>
  );
}
