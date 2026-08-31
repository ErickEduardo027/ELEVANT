import { CrosshairIcon } from '../../flight-monitoring/components/icons';
import { CubeIcon, LayersIcon, MaximizeIcon, MinimizeIcon } from './icons';

const buttonClass =
  'rounded-lg border border-black/10 bg-white/90 p-2 shadow-md backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card';

export default function MapControls({ viewMode, onToggleViewMode, onCenterPuj, fullscreen, onToggleFullscreen }) {
  return (
    <div className="absolute left-3 top-3 z-10 flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onToggleViewMode}
        title={viewMode === '3d' ? 'Vista 2D' : 'Vista 3D'}
        aria-label={viewMode === '3d' ? 'Cambiar a vista 2D' : 'Cambiar a vista 3D'}
        aria-pressed={viewMode === '3d'}
        className={buttonClass}
      >
        {viewMode === '3d' ? (
          <CubeIcon className="h-4 w-4 text-accent-600" />
        ) : (
          <LayersIcon className="h-4 w-4 text-ink-900 dark:text-text-primary-dark" />
        )}
      </button>
      <button
        type="button"
        onClick={onCenterPuj}
        title="Centrar PUJ"
        aria-label="Centrar PUJ"
        className={buttonClass}
      >
        <CrosshairIcon className="h-4 w-4 text-ink-900 dark:text-text-primary-dark" />
      </button>
      <button
        type="button"
        onClick={onToggleFullscreen}
        title={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
        aria-label={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
        className={buttonClass}
      >
        {fullscreen ? (
          <MinimizeIcon className="h-4 w-4 text-ink-900 dark:text-text-primary-dark" />
        ) : (
          <MaximizeIcon className="h-4 w-4 text-ink-900 dark:text-text-primary-dark" />
        )}
      </button>
    </div>
  );
}
