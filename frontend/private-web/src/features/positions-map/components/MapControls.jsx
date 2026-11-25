import { CrosshairIcon } from '../../flight-monitoring/components/icons';
import { CubeIcon, LayersIcon, MaximizeIcon, MinimizeIcon } from './icons';
import { useTranslation } from '../../../i18n/LanguageScope';
import { RAIL_ICON_TOOL, RAIL_TOOL_ROW } from '../../maps/ui/railClasses';
import { positionsMapMessages } from '../positionsMapMessages';

// The page's map tools (design B.5): 2D/3D, «Centrar PUJ» and full screen, in the map's control rail (CN-32, PositionMap's
// `railTools`), flat (no shadow, no blur) in one opaque slab, as the map's own control groups: the panel slab with a
// 1 px joint around and between the tools. One slab and not three see-through buttons with gaps, so nothing of the map,
// a label or a «Demo» plate in 3D, shows between or through them (N29). The slab clips nothing, so the focus ring of a
// tool stays whole; the first and last tools round their hover to the slab's inner corners. On a touch screen the
// three stand one under the other, each 44 px high, so the rail keeps its width.

const blockClass = `${RAIL_TOOL_ROW} [@media(pointer:coarse)]:flex-col [@media(pointer:coarse)]:divide-x-0 `
  + '[@media(pointer:coarse)]:divide-y';

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
        className={`${RAIL_ICON_TOOL} ${viewMode === '3d' ? 'bg-occ-accent-soft' : ''}`}
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
        className={RAIL_ICON_TOOL}
      >
        <CrosshairIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onToggleFullscreen}
        title={fullscreen ? t('controls.exitFullscreen') : t('controls.fullscreen')}
        aria-label={fullscreen ? t('controls.exitFullscreen') : t('controls.fullscreen')}
        className={RAIL_ICON_TOOL}
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
