import ModulePlaceholder from '../src/features/shell/components/ModulePlaceholder';
import { AlertTriangleIcon } from '../src/features/shell/components/icons';

export default function NotFound() {
  return <main className="min-h-screen bg-surface-light p-8 dark:bg-surface-dark"><ModulePlaceholder icon={AlertTriangleIcon} label="Página no encontrada" description="La ruta que buscas no existe." /></main>;
}
