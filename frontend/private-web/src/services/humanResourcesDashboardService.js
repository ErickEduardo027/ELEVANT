import { HUMAN_RESOURCES_DASHBOARD_MOCK } from '../features/human-resources/dashboard/dashboardMock';

// Adaptador stub: hoy resuelve con datos mock, mañana con una llamada REST.
// El consumidor (useHumanResourcesDashboardData) no necesita cambiar cuando
// esto se conecte a un endpoint real.
export async function getHumanResourcesDashboardSnapshot() {
  return HUMAN_RESOURCES_DASHBOARD_MOCK;
}
