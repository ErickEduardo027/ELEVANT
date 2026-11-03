import { PlusIcon, UploadIcon, DownloadIcon } from './icons';
import { RefreshCwIcon } from '../../dashboard/components/icons';
import { useTranslation } from '../../../i18n/LanguageScope';
import { planningMessages } from '../planningMessages';

function ActionButton({ icon: ActionIcon, label, onClick, disabled }) {
  const { t } = useTranslation(planningMessages);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? t('header.comingSoon') : label}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors duration-200 ${
        disabled
          ? 'cursor-not-allowed border-black/10 text-text-secondary-light/60 dark:border-white/10 dark:text-text-secondary-dark/60'
          : 'border-accent-600/30 text-accent-600 hover:bg-accent-600/10'
      }`}
    >
      <ActionIcon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

export default function PlanningHeader({ onRefresh, onCreate, canCreate = false, onImport, canImport = false }) {
  const { t } = useTranslation(planningMessages);
  return (
    <div className="space-y-3">
      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
        {t('header.breadcrumb')}
      </p>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink-900 dark:text-text-primary-dark">{t('header.title')}</h1>
          <p className="mt-1 max-w-xl text-sm text-text-secondary-light dark:text-text-secondary-dark">
            {t('header.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton icon={PlusIcon} label={t('header.newFlight')} onClick={onCreate} disabled={!canCreate} />
          <ActionButton icon={UploadIcon} label={t('header.importFlights')} onClick={onImport} disabled={!canImport} />
          <ActionButton icon={RefreshCwIcon} label={t('header.refresh')} onClick={onRefresh} />
          <ActionButton icon={DownloadIcon} label={t('header.export')} disabled />
        </div>
      </div>
    </div>
  );
}
