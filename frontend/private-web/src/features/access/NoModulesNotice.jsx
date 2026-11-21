import EmptyState from '../../components/EmptyState';
import { ShieldCheckIcon } from '../shell/components/icons';

export default function NoModulesNotice() {
  return <EmptyState icon={ShieldCheckIcon} title="Sin módulos asignados"
    description="Tu cuenta todavía no tiene permisos en este departamento. Pide acceso al administrador del departamento." />;
}
