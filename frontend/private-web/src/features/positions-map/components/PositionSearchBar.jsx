import { SearchIcon } from '../../flight-monitoring/components/icons';
import OccField, { occControlClass } from '../../occ-ui/OccField';
import { useTranslation } from '../../../i18n/LanguageScope';
import { positionsMapMessages } from '../positionsMapMessages';

// «Buscar posición»: filters the stands while it holds text, and Enter opens the stand it names.
export default function PositionSearchBar({ value, onChange, onSubmit, notFound = false }) {
  const { t } = useTranslation(positionsMapMessages);
  return (
    <OccField label={t('search.label')} error={notFound ? t('search.notFound') : undefined}
      className="w-full min-w-[14rem] max-w-[22rem] flex-1">
      {control => (
        <span className="relative block">
          <SearchIcon aria-hidden="true"
            className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-occ-muted" />
          <input {...control} type="text" value={value}
            onChange={event => onChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') onSubmit?.(value);
            }}
            placeholder={t('search.placeholder')}
            className={`w-full pl-8 ${occControlClass({ kind: 'input' })}`} />
        </span>
      )}
    </OccField>
  );
}
