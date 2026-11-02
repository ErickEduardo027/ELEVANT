import StatusBadge from '../../../components/StatusBadge';
import { STATUS_COLORS } from '../../dashboard/statusMeta';
import { EyeIcon } from './icons';
import { formatCountdown } from '../planningMappers';
import { getPlanningStatusMeta } from '../planningStatus';
import { formatPlanningClock } from '../planningTime';
import AssignmentSummary from './AssignmentSummary';
import { useTranslation } from '../../../i18n/LanguageScope';
import { planningMessages } from '../planningMessages';

const QUICK_ACTIONS = [
  { id: 'detail', icon: EyeIcon, enabled: true },
];

function LegSummary({ kind, leg, timeZone }) {
  const { t, locale } = useTranslation(planningMessages);
  const label = t(kind === 'arrival' ? 'card.arrival' : 'card.departure');

  if (!leg) {
    return (
      <div className="rounded-lg border border-dashed border-black/10 px-3 py-2 dark:border-white/10">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary-light dark:text-text-secondary-dark">{label}</p>
        <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">{t('card.noLeg')}</p>
      </div>
    );
  }

  const route = `${leg.origin.iataCode} → ${leg.destination.iataCode}`;
  const scheduled = formatPlanningClock(leg.scheduledAt, timeZone, locale);
  const estimated = formatPlanningClock(leg.estimatedAt, timeZone, locale);
  const actual = formatPlanningClock(leg.actualAt, timeZone, locale);

  return (
    <div className="rounded-lg border border-black/5 bg-white/55 px-3 py-2 dark:border-white/5 dark:bg-white/[0.03]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary-light dark:text-text-secondary-dark">{label}</p>
        <span className="font-mono text-xs font-semibold text-ink-900 dark:text-text-primary-dark">{leg.flightNumber}</span>
      </div>
      <div className="mt-1 flex items-end justify-between gap-3">
        <span className="font-mono text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{route}</span>
        <span className="font-mono text-sm text-accent-600">{actual !== '—' ? actual : estimated !== '—' ? estimated : scheduled}</span>
      </div>
      {(estimated !== '—' || actual !== '—') && (
        <p className="mt-1 text-right font-mono text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
          {t('card.scheduled', { time: scheduled })}
        </p>
      )}
    </div>
  );
}

export default function FlightCard({ flight, now, onSelect }) {
  const { t, language } = useTranslation(planningMessages);
  const meta = getPlanningStatusMeta(flight.status, language);
  const accentColor = STATUS_COLORS[meta.color];
  const timeZone = flight.station?.ianaTimeZone;

  return (
    <article
      data-testid="flight-card"
      onClick={() => onSelect(flight.id)}
      style={{ borderLeftWidth: 4, borderLeftColor: accentColor }}
      className="cursor-pointer rounded-xl border border-black/5 bg-white/70 p-3 shadow-sm backdrop-blur-md transition-shadow hover:shadow-md dark:border-white/5 dark:bg-surface-dark-card"
    >
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone={meta.color} label={meta.label} />
        <span className="font-mono text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{flight.operationCode}</span>
        <span className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
          {flight.airlineIata} · {flight.airlineName}
        </span>
        <span className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {flight.aircraftType ?? t('card.noAircraft')}
        </span>
        <span className="ml-auto font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {formatCountdown(flight.timelineTime, now, language)}
        </span>
        <div className="flex items-center gap-1" onClick={event => event.stopPropagation()}>
          {QUICK_ACTIONS.filter(action => action.enabled).map(({ id, icon: ActionIcon, enabled }) => (
            <button
              key={id}
              type="button"
              title={enabled ? t(`card.${id}`) : t('card.comingSoon')}
              aria-label={t(`card.${id}`)}
              disabled={!enabled}
              onClick={() => enabled && onSelect(flight.id)}
              className={`rounded-md p-1.5 transition ${enabled
                ? 'text-text-secondary-light hover:bg-black/5 hover:text-accent-600 dark:text-text-secondary-dark dark:hover:bg-white/5'
                : 'cursor-not-allowed text-text-secondary-light/35 dark:text-text-secondary-dark/35'}`}
            >
              <ActionIcon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-stretch">
        <LegSummary kind="arrival" leg={flight.arrival} timeZone={timeZone} />
        <div className="flex min-w-[130px] flex-col items-center justify-center rounded-lg bg-ink-900/[0.035] px-3 py-2 text-center dark:bg-white/[0.04]">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary-light dark:text-text-secondary-dark">{t('card.turnaround')}</span>
          <span className="mt-1 font-mono text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{flight.position ?? t('card.noPosition')}</span>
          <span className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">{flight.terminalCode ? t('card.terminal', { code: flight.terminalCode }) : t('card.noTerminal')}</span>
        </div>
        <LegSummary kind="departure" leg={flight.departure} timeZone={timeZone} />
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 border-t border-black/5 pt-2 dark:border-white/5">
        <AssignmentSummary
          position={flight.position}
          agents={flight.assignedAgents ?? []}
          equipment={flight.assignedEquipment ?? []}
          services={flight.assignedServices ?? []}
        />
        {flight.hasAssignmentGap && (
          <span className="rounded-full bg-status-warning/10 px-2 py-0.5 text-[10px] font-semibold text-status-warning">{t('card.needsResources')}</span>
        )}
      </div>
    </article>
  );
}
