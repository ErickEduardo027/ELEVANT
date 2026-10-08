'use client';

import { HUMAN_RESOURCES_DASHBOARD_READ_ONLY_DEMO } from '../../config/hrDemoMode';
import HumanResourcesDashboardPage from './dashboard/DashboardPage';
import RampProfilesPanel from './users/RampProfilesPanel';
import CertificationsPage from './certifications/CertificationsPage';
import CurrentQualificationsPage from './certifications/CurrentQualificationsPage';
import CurrentPermitsPage from './permits/CurrentPermitsPage';
import CurrentShiftsPage from './schedules/CurrentShiftsPage';
import AttendanceReviewPage from './attendance/AttendanceReviewPage';
import PermitsPage from './permits/PermitsPage';
import SchedulesPage from './schedules/SchedulesPage';
import CurrentReportsPage from './reports/CurrentReportsPage';
import AuditRoute from './audit/AuditRoute';
import NotificationsRoute from './notifications/NotificationsRoute';
import ModulePlaceholder from '../shell/components/ModulePlaceholder';
import DepartmentUsersPage from '../department-users/DepartmentUsersPage';
import AccessValidationsPage from '../department-users/AccessValidationsPage';
import { DEPARTMENTS } from '../../services/departmentGovernanceService';
import { HUMAN_RESOURCES_NAVIGATION } from './navigation';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function HRModulePage({ moduleId }) {
  const router = useRouter();
  const unavailableInRestrictedRelease = HUMAN_RESOURCES_DASHBOARD_READ_ONLY_DEMO
    && ['audit', 'notifications'].includes(moduleId);

  useEffect(() => {
    if (unavailableInRestrictedRelease) router.replace('/gestion-humana/dashboard');
  }, [router, unavailableInRestrictedRelease]);

  if (unavailableInRestrictedRelease) return null;
  if (moduleId === 'dashboard') return <HumanResourcesDashboardPage dashboardReadOnlyDemo={HUMAN_RESOURCES_DASHBOARD_READ_ONLY_DEMO} />;
  if (moduleId === 'users') return <RampProfilesPanel />;
  if (moduleId === 'certifications') return HUMAN_RESOURCES_DASHBOARD_READ_ONLY_DEMO ? <CurrentQualificationsPage /> : <CertificationsPage />;
  if (moduleId === 'permits') return HUMAN_RESOURCES_DASHBOARD_READ_ONLY_DEMO ? <CurrentPermitsPage /> : <PermitsPage />;
  if (moduleId === 'schedules') return HUMAN_RESOURCES_DASHBOARD_READ_ONLY_DEMO ? <CurrentShiftsPage /> : <SchedulesPage />;
  if (moduleId === 'attendance') return <AttendanceReviewPage />;
  if (moduleId === 'reports') return <CurrentReportsPage />;
  if (moduleId === 'audit') return <AuditRoute />;
  if (moduleId === 'notifications') return <NotificationsRoute />;
  if (moduleId === 'access-requests') return <AccessValidationsPage />;
  if (moduleId === 'department-users') return <DepartmentUsersPage department={DEPARTMENTS.HUMAN_RESOURCES} />;

  const moduleItem = HUMAN_RESOURCES_NAVIGATION.find(item => item.id === moduleId);
  return moduleItem ? <ModulePlaceholder icon={moduleItem.icon} label={moduleItem.label} description={moduleItem.description} /> : null;
}
