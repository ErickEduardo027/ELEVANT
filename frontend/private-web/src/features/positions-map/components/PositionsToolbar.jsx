import OccButton from '../../occ-ui/OccButton';
import OccToolbar from '../../occ-ui/OccToolbar';
import { ListIcon } from './icons';
import PositionSearchBar from './PositionSearchBar';
import TerminalSelector from './TerminalSelector';
import { useTranslation } from '../../../i18n/LanguageScope';
import { positionsMapMessages } from '../positionsMapMessages';

// The bar of Mapa de posiciones (design E.1 and F, occ-ui/OccToolbar.jsx): the page's `h1` with the station in secondary
// text, then the terminal, the search and «Lista de posiciones», which opens the dense table at the left of the map.
export default function PositionsToolbar({
  search,
  onSearchChange,
  onSearchSubmit,
  searchNotFound,
  terminalFilter,
  onTerminalChange,
  onToggleSidePanel,
  sidePanelOpen,
  count = null,
}) {
  const { t } = useTranslation(positionsMapMessages);
  return (
    <OccToolbar
      title={t('toolbar.title')}
      summary={(
        <span className="flex flex-wrap gap-x-3">
          <span>{t('toolbar.subtitle')}</span>
          {Number.isInteger(count) ? <span>{t('toolbar.summary', { count })}</span> : null}
        </span>
      )}
      actions={(
        <OccButton onClick={onToggleSidePanel} aria-pressed={sidePanelOpen}
          className={sidePanelOpen ? 'border-occ-accent bg-occ-accent-soft' : ''}>
          <ListIcon className="h-4 w-4" aria-hidden="true" />
          {t('toolbar.list')}
        </OccButton>
      )}
    >
      <TerminalSelector active={terminalFilter} onChange={onTerminalChange} />
      <PositionSearchBar value={search} onChange={onSearchChange} onSubmit={onSearchSubmit} notFound={searchNotFound} />
    </OccToolbar>
  );
}
