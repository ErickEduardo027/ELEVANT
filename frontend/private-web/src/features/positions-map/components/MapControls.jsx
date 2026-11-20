import { CrosshairIcon } from '../../flight-monitoring/components/icons';
import { CubeIcon, LayersIcon, MaximizeIcon, MinimizeIcon } from './icons';
import { useTranslation } from '../../../i18n/LanguageScope';
import { positionsMapMessages } from '../positionsMapMessages';

// The page's map tools (design B.5), flat (no shadow, no blur) in one opaque block, as the map's own control groups: the
// panel slab with a 1 px joint around and between the tools. One slab and not three see-through buttons with gaps, so
// nothing of the map, a label or a «Demo» plate in 3D, shows between or through them (N29). The block clips nothing,
// so the focus ring of a tool stays whole; the first and last tools round their hover to the block's inner corners.
const blockClass = 'absolute left-3 top-3 z-10 flex flex-col divide-y divide-occ-line rounded border border-occ-line '
  + 'bg-occ-panel';
const buttonClass = 'flex min-h-9 min-w-9 items-center justify-center text-occ-text hover:bg-occ-panel-raised '
  + 'first:rounded-t-[3px] last:rounded-b-[3px] [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11';

export default function MapControls({ viewMode, onToggleViewMode, onCenterPuj, fullscreen, onToggleFullscreen }) {
  const { t } = useTranslation(positionsMapMessages);
  return (
    <div className={blockClass}>
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
