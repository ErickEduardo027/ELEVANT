import OccSegmented from '../../occ-ui/OccSegmented';
import { TERMINAL_FILTERS } from '../positionsMapMappers';
import { useTranslation } from '../../../i18n/LanguageScope';
import { positionsMapMessages } from '../positionsMapMessages';

// The terminals as a segmented control (occ-ui/OccSegmented.jsx): a group of toggle buttons, «Todas» first.
export default function TerminalSelector({ active, onChange }) {
  const { t } = useTranslation(positionsMapMessages);
  return (
    <OccSegmented label={t('terminals.filterLabel')} value={active} onChange={onChange}
      options={TERMINAL_FILTERS.map(({ id }) => ({ id, label: t(`terminals.filters.${id}`) }))} />
  );
}
