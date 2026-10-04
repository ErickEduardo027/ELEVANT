export const HR_DASHBOARD_READ_ONLY_DEMO_MODE = 'dashboard-read-only';

export function isHumanResourcesDashboardReadOnlyDemo(environment = process.env) {
  return environment?.NEXT_PUBLIC_HR_DEMO_MODE === HR_DASHBOARD_READ_ONLY_DEMO_MODE;
}

export const HUMAN_RESOURCES_DASHBOARD_READ_ONLY_DEMO =
  isHumanResourcesDashboardReadOnlyDemo();
