import { CrosshairIcon } from '../../flight-monitoring/components/icons';
import { CubeIcon, LayersIcon, MaximizeIcon, MinimizeIcon } from './icons';
import { useTranslation } from '../../../i18n/LanguageScope';
import { positionsMapMessages } from '../positionsMapMessages';

// Flat map tools on the floating slab (design B.5): a joint, no shadow and no blur.
const buttonClass = 'flex min-h-9 min-w-9 items-center justify-center rounded border border-occ-line bg-occ-panel-float '
  + 'text-occ-text hover:bg-occ-panel-raised [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11';

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
          <CubeIcon className="h-4 w-4 text-occ-accent" />
        ) : (
          <LayersIcon className="h-4 w-4" />
        )}
      </button>
      <button
        type="button"
        onClick={onCenterPuj}
        title={t('controls.centerPuj')}
        aria-label={t('controls.centerPuj')}
        className={buttonClass}
      >
        <CrosshairIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onToggleFullscreen}
        title={fullscreen ? t('controls.exitFullscreen') : t('controls.fullscreen')}
        aria-label={fullscreen ? t('controls.exitFullscreen') : t('controls.fullscreen')}
        className={buttonClass}
      >
        {fullscreen ? (
          <MinimizeIcon className="h-4 w-4" />
        ) : (
          <MaximizeIcon className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}
