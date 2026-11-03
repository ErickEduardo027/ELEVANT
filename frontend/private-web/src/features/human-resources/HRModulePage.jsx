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
import HumanResourcesAuditPage from '../employees/HumanResourcesAuditPage';
import EmployeesPage from '../employees/EmployeesPage';
import PositionsPage from '../employees/PositionsPage';
import RequisitionsPage from '../employees/RequisitionsPage';
import NotificationsRoute from './notifications/NotificationsRoute';
import ModulePlaceholder from '../shell/components/ModulePlaceholder';
import DepartmentExpensesPage from '../finance/payables/DepartmentExpensesPage';
import DepartmentUsersPage from '../department-users/DepartmentUsersPage';
import AccessValidationsPage from '../department-users/AccessValidationsPage';
import { DEPARTMENTS } from '../../services/departmentGovernanceService';
import { HUMAN_RESOURCES_NAVIGATION } from './navigation';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function HRModulePage({ moduleId }) {
  const router = useRouter();
  const unavailableInRestrictedRelease = HUMAN_RESOURCES_DASHBOARD_READ_ONLY_DEMO
    && moduleId === 'notifications';

  useEffect(() => {
    if (unavailableInRestrictedRelease) router.replace('/gestion-humana/dashboard');
  }, [router, unavailableInRestrictedRelease]);

  if (unavailableInRestrictedRelease) return null;
  if (moduleId === 'dashboard') return <HumanResourcesDashboardPage dashboardReadOnlyDemo={HUMAN_RESOURCES_DASHBOARD_READ_ONLY_DEMO} />;
  if (moduleId === 'expenses') return <DepartmentExpensesPage />;
  if (moduleId === 'employees') return <EmployeesPage />;
  if (moduleId === 'positions') return <PositionsPage />;
  if (moduleId === 'requisitions') return <RequisitionsPage />;
  if (moduleId === 'users') return <div className="space-y-5"><RampReadinessPanel /><RampProfilesPanel /></div>;
  if (moduleId === 'certifications') return <CurrentQualificationsPage />;
  if (moduleId === 'permits') return <CurrentPermitsPage />;
  if (moduleId === 'schedules') return <CurrentShiftsPage />;
  if (moduleId === 'attendance') return <AttendanceReviewPage />;
  if (moduleId === 'reports') return <CurrentReportsPage />;
  if (moduleId === 'audit') return <HumanResourcesAuditPage />;
  if (moduleId === 'notifications') return <NotificationsRoute />;
  if (moduleId === 'access-requests') return <AccessValidationsPage />;
  if (moduleId === 'department-users') return <DepartmentUsersPage department={DEPARTMENTS.HUMAN_RESOURCES} />;

  const moduleItem = HUMAN_RESOURCES_NAVIGATION.find(item => item.id === moduleId);
  return moduleItem ? <ModulePlaceholder icon={moduleItem.icon} label={moduleItem.label} description={moduleItem.description} /> : null;
}
