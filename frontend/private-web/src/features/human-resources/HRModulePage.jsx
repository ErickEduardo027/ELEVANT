'use client';

import { HUMAN_RESOURCES_DASHBOARD_READ_ONLY_DEMO } from '../../config/hrDemoMode';
import HumanResourcesDashboardPage from './dashboard/DashboardPage';
import RampProfilesPanel from './users/RampProfilesPanel';
import RampReadinessPanel from './users/RampReadinessPanel';
import CurrentQualificationsPage from './certifications/CurrentQualificationsPage';
import CurrentPermitsPage from './permits/CurrentPermitsPage';
import CurrentShiftsPage from './schedules/CurrentShiftsPage';
import AttendanceReviewPage from './attendance/AttendanceReviewPage';
import CurrentReportsPage from './reports/CurrentReportsPage';
import HumanResourcesSettingsPage from './settings/HumanResourcesSettingsPage';
import HumanResourcesAuditPage from '../employees/HumanResourcesAuditPage';
import EmployeesPage from '../employees/EmployeesPage';
import ModulePlaceholder from '../shell/components/ModulePlaceholder';
import DepartmentUsersPage from '../department-users/DepartmentUsersPage';
import AccessValidationsPage from '../department-users/AccessValidationsPage';
import { DEPARTMENTS } from '../../services/departmentGovernanceService';
import { HUMAN_RESOURCES_NAVIGATION } from './navigation';

export default function HRModulePage({ moduleId }) {
  if (moduleId === 'dashboard') return <HumanResourcesDashboardPage dashboardReadOnlyDemo={HUMAN_RESOURCES_DASHBOARD_READ_ONLY_DEMO} />;
  if (moduleId === 'employees') return <EmployeesPage />;
  // «¿Puede operar?» goes inside the page of «Agentes de rampa», after its heading (N37).
  if (moduleId === 'users') return <RampProfilesPanel lead={<RampReadinessPanel />} />;
  if (moduleId === 'certifications') return <CurrentQualificationsPage />;
  if (moduleId === 'permits') return <CurrentPermitsPage />;
  if (moduleId === 'schedules') return <CurrentShiftsPage />;
  if (moduleId === 'attendance') return <AttendanceReviewPage />;
  if (moduleId === 'reports') return <CurrentReportsPage />;
  if (moduleId === 'settings') return <HumanResourcesSettingsPage />;
  if (moduleId === 'audit') return <HumanResourcesAuditPage />;
  if (moduleId === 'access-requests') return <AccessValidationsPage />;
  if (moduleId === 'department-users') return <DepartmentUsersPage department={DEPARTMENTS.HUMAN_RESOURCES} />;

  const moduleItem = HUMAN_RESOURCES_NAVIGATION.find(item => item.id === moduleId);
  return moduleItem ? <ModulePlaceholder icon={moduleItem.icon} label={moduleItem.label} description={moduleItem.description} /> : null;
}
