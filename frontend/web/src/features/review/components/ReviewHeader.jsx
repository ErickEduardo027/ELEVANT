import { DownloadIcon } from '../../planning/components/icons';
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

export default function ReviewHeader({ onRefresh }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Dashboard / Revisión</p>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink-900 dark:text-text-primary-dark">Revisión</h1>
          <p className="mt-1 max-w-xl text-sm text-text-secondary-light dark:text-text-secondary-dark">
            Revise y valide las operaciones de ground handling antes de enviarlas a Finanzas.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton icon={RefreshCwIcon} label="Actualizar" onClick={onRefresh} />
          <ActionButton icon={DownloadIcon} label="Exportar" disabled />
        </div>
      </div>
    </div>
  );
}
