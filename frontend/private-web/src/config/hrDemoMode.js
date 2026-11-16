export const HR_DASHBOARD_READ_ONLY_DEMO_MODE = 'dashboard-read-only';

// Next only inlines the literal `process.env.NEXT_PUBLIC_*` expression into
// browser bundles; reading `process.env` as an object yields `{}` on the
// client and silently disables the flag there.
const CONFIGURED_HR_DEMO_MODE = process.env.NEXT_PUBLIC_HR_DEMO_MODE;

export function isHumanResourcesDashboardReadOnlyDemo(
  environment = { NEXT_PUBLIC_HR_DEMO_MODE: CONFIGURED_HR_DEMO_MODE },
) {
  return environment?.NEXT_PUBLIC_HR_DEMO_MODE === HR_DASHBOARD_READ_ONLY_DEMO_MODE;
}

export const HUMAN_RESOURCES_DASHBOARD_READ_ONLY_DEMO =
  isHumanResourcesDashboardReadOnlyDemo();
