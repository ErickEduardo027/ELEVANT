import { PlusIcon, UploadIcon, DownloadIcon } from './icons';
import { RefreshCwIcon } from '../../dashboard/components/icons';

function ActionButton({ icon: ActionIcon, label, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'Próximamente' : label}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors duration-200 ${
        disabled
          ? 'cursor-not-allowed border-black/10 text-text-secondary-light/60 dark:border-white/10 dark:text-text-secondary-dark/60'
          : 'border-accent-600/30 text-accent-600 hover:bg-accent-600/10'
      }`}
    >
      <ActionIcon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

export default function PlanningHeader({ onRefresh, onCreate, canCreate = false }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
        Dashboard / Planificación Operativa
      </p>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink-900 dark:text-text-primary-dark">Planificación Operativa</h1>
          <p className="mt-1 max-w-xl text-sm text-text-secondary-light dark:text-text-secondary-dark">
            Consulte las escalas, sus tramos y los recursos operativos autorizados para cada estación.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton icon={PlusIcon} label="Nuevo vuelo" onClick={onCreate} disabled={!canCreate} />
          <ActionButton icon={UploadIcon} label="Importar vuelos" disabled />
          <ActionButton icon={RefreshCwIcon} label="Actualizar" onClick={onRefresh} />
          <ActionButton icon={DownloadIcon} label="Exportar" disabled />
        </div>
      </div>
    </div>
  );
}
