import PositionSearchBar from './PositionSearchBar';
import TerminalSelector from './TerminalSelector';
import { ListIcon } from './icons';

export default function PositionsToolbar({
  search,
  onSearchChange,
  onSearchSubmit,
  searchNotFound,
  terminalFilter,
  onTerminalChange,
  onToggleSidePanel,
  sidePanelOpen,
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold text-ink-900 dark:text-text-primary-dark">Mapa de posiciones</h1>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
            PUJ · Aeropuerto Internacional de Punta Cana
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleSidePanel}
          aria-pressed={sidePanelOpen}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
            sidePanelOpen
              ? 'border-accent-600 bg-accent-600/10 text-accent-600'
              : 'border-black/10 text-ink-900 hover:bg-black/5 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5'
          }`}
        >
          <ListIcon className="h-3.5 w-3.5" />
          Lista de posiciones
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <TerminalSelector active={terminalFilter} onChange={onTerminalChange} />
        <PositionSearchBar value={search} onChange={onSearchChange} onSubmit={onSearchSubmit} notFound={searchNotFound} />
      </div>
    </div>
  );
}
