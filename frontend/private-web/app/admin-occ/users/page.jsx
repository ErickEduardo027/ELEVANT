'use client';

import DepartmentUsersPage from '../../../src/features/department-users/DepartmentUsersPage';
import { DEPARTMENTS } from '../../../src/services/departmentGovernanceService';

export default function Page() { return <DepartmentUsersPage department={DEPARTMENTS.OPERATIONS} />; }
