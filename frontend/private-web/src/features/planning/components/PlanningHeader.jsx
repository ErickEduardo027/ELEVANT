import OccButton from '../../occ-ui/OccButton';
import OccToolbar from '../../occ-ui/OccToolbar';
import { PlusIcon, UploadIcon } from './icons';
import { RefreshCwIcon } from '../../dashboard/components/icons';
import { useTranslation } from '../../../i18n/LanguageScope';
import { planningMessages } from '../planningMessages';

// The bar of Planificación (design E.1 template C, occ-ui/OccToolbar.jsx): the page's `h1`, the count of the day's
// turnarounds on its line, and «Nuevo vuelo», «Importar vuelos» and «Actualizar». A command that needs a station and a
// date in scope says why it waits in its title. `children` are the controls that scope the page (the filters).
function ActionButton({ icon: ActionIcon, label, onClick, disabled, primary = false }) {
  const { t } = useTranslation(planningMessages);
  return (
    <OccButton variant={primary ? 'primary' : 'secondary'} onClick={onClick} disabled={disabled}
      title={disabled ? t('header.unavailable') : label}>
      <ActionIcon className="h-4 w-4" aria-hidden="true" />
      {label}
    </OccButton>
  );
}

export default function PlanningHeader({ onRefresh, onCreate, canCreate = false, onImport, canImport = false, count = null,
  children }) {
  const { t } = useTranslation(planningMessages);
  return (
    <OccToolbar
      title={t('header.title')}
      summary={Number.isInteger(count) ? t('page.summary', { count }) : null}
      actions={(
        <>
          <ActionButton icon={PlusIcon} label={t('header.newFlight')} onClick={onCreate} disabled={!canCreate} primary />
          <ActionButton icon={UploadIcon} label={t('header.importFlights')} onClick={onImport} disabled={!canImport} />
          <ActionButton icon={RefreshCwIcon} label={t('header.refresh')} onClick={onRefresh} />
        </>
      )}
    >
      {children}
    </OccToolbar>
  );
}
