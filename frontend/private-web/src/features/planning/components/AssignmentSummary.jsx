import { MapPinIcon, UsersIcon } from '../../dashboard/components/icons';
import { useTranslation } from '../../../i18n/LanguageScope';
import { planningMessages } from '../planningMessages';

export default function AssignmentSummary({
  position,
  agents = [],
  equipment = [],
  services = [],
}) {
  const { t } = useTranslation(planningMessages);
  const hasAssignment = Boolean(position) || agents.length > 0 || equipment.length > 0 || services.length > 0;

  if (!hasAssignment) {
    return <span className="text-xs text-status-warning">{t('summary.pending')}</span>;
  }

  return (
    <span className="flex flex-wrap items-center gap-3 text-xs text-text-secondary-light dark:text-text-secondary-dark">
      {position && (
        <span className="inline-flex items-center gap-1">
          <MapPinIcon className="h-3.5 w-3.5" />
          {position}
        </span>
      )}
      <span className="inline-flex items-center gap-1" title={t('summary.assignedAgents')}>
        <UsersIcon className="h-3.5 w-3.5" />
        {t(agents.length === 1 ? 'summary.agentOne' : 'summary.agentMany', { count: agents.length })}
      </span>
      <span>{t(equipment.length === 1 ? 'summary.equipmentOne' : 'summary.equipmentMany', { count: equipment.length })}</span>
      <span>{t(services.length === 1 ? 'summary.serviceOne' : 'summary.serviceMany', { count: services.length })}</span>
    </span>
  );
}
