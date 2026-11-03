import { CrosshairIcon } from '../../flight-monitoring/components/icons';
import { CubeIcon, LayersIcon, MaximizeIcon, MinimizeIcon } from './icons';
import { useTranslation } from '../../../i18n/LanguageScope';
import { positionsMapMessages } from '../positionsMapMessages';

const buttonClass =
  'rounded-lg border border-black/10 bg-white/90 p-2 shadow-md backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card';

export default function MapControls({ viewMode, onToggleViewMode, onCenterPuj, fullscreen, onToggleFullscreen }) {
  const { t } = useTranslation(positionsMapMessages);
  return (
    <div className="absolute left-3 top-3 z-10 flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onToggleViewMode}
        title={viewMode === '3d' ? t('controls.view2d') : t('controls.view3d')}
        aria-label={viewMode === '3d' ? t('controls.switchTo2d') : t('controls.switchTo3d')}
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
        title={t('controls.centerPuj')}
        aria-label={t('controls.centerPuj')}
        className={buttonClass}
      >
        <CrosshairIcon className="h-4 w-4 text-ink-900 dark:text-text-primary-dark" />
      </button>
      <button
        type="button"
        onClick={onToggleFullscreen}
        title={fullscreen ? t('controls.exitFullscreen') : t('controls.fullscreen')}
        aria-label={fullscreen ? t('controls.exitFullscreen') : t('controls.fullscreen')}
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
