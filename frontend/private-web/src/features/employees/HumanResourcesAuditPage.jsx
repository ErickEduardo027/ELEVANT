import PageHeader from '../../components/PageHeader';
import { listAudit } from '../../services/humanResourcesEmployeesService';
import ActivityPanel from './ActivityPanel';

/** People-governance trail read from the API: hires, transfers, terminations, access decisions and sign-ins. */
export default function HumanResourcesAuditPage() {
  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <PageHeader eyebrow="Gestión Humana" title="Trazabilidad / Auditoría"
        description="Altas, traslados, bajas, decisiones de acceso e inicios de sesión del personal." />
      <ActivityPanel load={listAudit} departmentFilter />
    </div>
  );
}
