import { useEffect, useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { planningMessages } from '../planningMessages';

function EmptyValue({ children }) {
  return <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">{children}</p>;
}

function OptionsFailure({ state, onRetry }) {
  const { t } = useTranslation(planningMessages);
  if (state.status === 'unauthorized') {
    return <p role="alert" className="text-sm text-status-danger">{t('assignment.sessionExpired')}</p>;
  }

  if (state.status === 'forbidden') {
    return <p role="alert" className="text-sm text-status-danger">{t('assignment.forbidden')}</p>;
  }

  return (
    <div role="alert" className="space-y-2 rounded-xl border border-status-warning/30 bg-status-warning/10 p-3">
      <p className="text-xs font-semibold text-status-warning">
        {state.reason === 'options-conflict'
          ? t('assignment.optionsConflict')
          : t('assignment.optionsError')}
      </p>
      {state.recoverable && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded text-xs font-semibold text-accent-600 hover:underline focus:outline-none focus:ring-2 focus:ring-accent-600 focus:ring-offset-2"
        >
          {t('assignment.retry')}
        </button>
      )}
    </div>
  );
}

function assignmentBlocker({ assignable, contract, services, eligibleAgents, etag }) {
  if (!assignable) return 'assignment.notAssignable';
  if (!contract) return 'assignment.noContractBlocker';
  if (services.length === 0) return 'assignment.noServicesBlocker';
  if (eligibleAgents.length === 0) return 'assignment.noEligibleBlocker';
  if (!etag) return 'assignment.noEtagBlocker';
  return null;
}

export default function OccAssignmentPanel({
  optionsState,
  assignmentState,
  assignable = true,
  onAssign,
  onRetryOptions,
}) {
  const { t } = useTranslation(planningMessages);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const optionVersion = `${optionsState.data?.turnaround?.id ?? ''}|${optionsState.etag ?? ''}`;

  useEffect(() => {
    setSelectedAgentId('');
  }, [optionVersion]);

  if (!assignable) {
    return (
      <div className="space-y-3">
        <p role="status" className="rounded-xl border border-status-warning/25 bg-status-warning/10 p-3 text-xs text-status-warning">
          {t('assignment.notAssignable')}
        </p>
        <button
          type="button"
          disabled
          className="w-full cursor-not-allowed rounded-xl bg-accent-600 px-4 py-3 text-sm font-semibold text-white opacity-45"
        >
          {t('assignment.submit')}
        </button>
      </div>
    );
  }

  if (optionsState.status === 'idle' || optionsState.status === 'loading') {
    return (
      <p role="status" className="animate-pulse text-sm text-text-secondary-light dark:text-text-secondary-dark">
        {t('assignment.loading')}
      </p>
    );
  }

  if (['unauthorized', 'forbidden', 'error'].includes(optionsState.status)) {
    return <OptionsFailure state={optionsState} onRetry={onRetryOptions} />;
  }

  const { contract = null, services = [], agents = [] } = optionsState.data ?? {};
  const eligibleAgents = agents.filter(agent => agent.eligible === true);
  const blocker = assignmentBlocker({
    assignable,
    contract,
    services,
    eligibleAgents,
    etag: optionsState.etag,
  });
  const reasonLabels = t('assignment.reasons');
  const isSubmitting = assignmentState.status === 'submitting';
  const canSubmit = !blocker && Boolean(selectedAgentId) && !isSubmitting;

  function submitAssignment(event) {
    event.preventDefault();
    if (!canSubmit) return;
    onAssign(selectedAgentId);
  }

  return (
    <form
      onSubmit={submitAssignment}
      aria-label={t('assignment.formLabel')}
      aria-busy={isSubmitting}
      className="space-y-4"
    >
      <div className="overflow-hidden rounded-2xl border border-ink-900/10 bg-white shadow-sm dark:border-white/10 dark:bg-white/[0.025]">
        <div className="border-l-4 border-signal-500 bg-ink-900/[0.035] px-4 py-3 dark:bg-white/[0.035]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-signal-500">
                {t('assignment.manifest')}
              </p>
              <p className="mt-1 text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
                {t('assignment.manifestTitle')}
              </p>
            </div>
            <span className="rounded-full border border-status-success/25 bg-status-success/10 px-2 py-1 text-[10px] font-semibold text-status-success">
              {t('assignment.synced')}
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-text-secondary-light dark:text-text-secondary-dark">
            {t('assignment.manifestHint')}
          </p>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary-light dark:text-text-secondary-dark">
              {t('assignment.contract')}
            </p>
            {contract ? (
              <p className="mt-1 text-sm font-medium">
                {contract.code} <span className="text-text-secondary-light dark:text-text-secondary-dark">{t('assignment.contractVersion', { version: contract.version, currency: contract.currencyCode })}</span>
              </p>
            ) : (
              <EmptyValue>{t('assignment.noContract')}</EmptyValue>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary-light dark:text-text-secondary-dark">
                {t('assignment.services')}
              </p>
              {services.length > 0 && (
                <span className="font-mono text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                  {t(services.length === 1 ? 'assignment.lineOne' : 'assignment.lineMany', { count: services.length })}
                </span>
              )}
            </div>
            {services.length === 0 ? (
              <EmptyValue>{t('assignment.noServices')}</EmptyValue>
            ) : (
              <ol className="mt-2 divide-y divide-black/5 border-y border-black/5 dark:divide-white/5 dark:border-white/5">
                {services.map((service, index) => (
                  <li key={service.id} className="grid grid-cols-[1.75rem_1fr_auto] items-start gap-2 py-2.5">
                    <span className="font-mono text-[10px] font-semibold text-signal-500">{String(index + 1).padStart(2, '0')}</span>
                    <span className="text-xs">
                      <strong>{service.code}</strong> · {service.name}
                    </span>
                    <span className="whitespace-nowrap font-mono text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                      {service.minimumQuantity} {service.billingUnit}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-2 text-[11px] text-text-secondary-light dark:text-text-secondary-dark">
              {t('assignment.servicesHint')}
            </p>
          </div>
        </div>
      </div>

      <fieldset disabled={isSubmitting || Boolean(blocker)} className="space-y-2">
        <legend className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary-light dark:text-text-secondary-dark">
          {t('assignment.rampAgent')}
        </legend>
        {agents.length === 0 ? (
          <EmptyValue>{t('assignment.noCandidates')}</EmptyValue>
        ) : (
          <div className="space-y-2">
            {agents.map(agent => {
              const isSelected = selectedAgentId === agent.id;
              return (
                <label
                  key={agent.id}
                  className={`block rounded-xl border px-3 py-3 transition-colors ${
                    agent.eligible
                      ? isSelected
                        ? 'border-accent-600 bg-accent-600/[0.06] ring-1 ring-accent-600'
                        : 'cursor-pointer border-black/10 hover:border-accent-600/45 dark:border-white/10'
                      : 'cursor-not-allowed border-black/5 bg-black/[0.025] opacity-70 dark:border-white/5 dark:bg-white/[0.025]'
                  }`}
                >
                  <span className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="occ-assignment-agent"
                      value={agent.id}
                      checked={isSelected}
                      disabled={!agent.eligible || isSubmitting || Boolean(blocker)}
                      onChange={() => setSelectedAgentId(agent.id)}
                      className="mt-0.5 h-4 w-4 accent-accent-600 focus:ring-2 focus:ring-accent-600 focus:ring-offset-2"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{agent.displayName}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${agent.eligible ? 'bg-status-success/10 text-status-success' : 'bg-status-warning/10 text-status-warning'}`}>
                          {agent.eligible ? t('assignment.eligible') : t('assignment.notEligible')}
                        </span>
                      </span>
                      <span className="mt-0.5 block font-mono text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                        {agent.employeeNumber}
                      </span>
                      {!agent.eligible && agent.eligibilityReasons.length > 0 && (
                        <span className="mt-1.5 block text-[11px] leading-relaxed text-text-secondary-light dark:text-text-secondary-dark">
                          {agent.eligibilityReasons
                            .map(reason => reasonLabels[reason] ?? t('assignment.unknownReason'))
                            .join(' · ')}
                        </span>
                      )}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </fieldset>

      {blocker && (
        <p role="status" className="rounded-xl border border-status-warning/25 bg-status-warning/10 p-3 text-xs text-status-warning">
          {t(blocker)}
        </p>
      )}

      {assignmentState.status === 'error' && (
        <p role="alert" className="rounded-xl border border-status-danger/25 bg-status-danger/10 p-3 text-xs text-status-danger">
          {assignmentState.error?.message ?? t('assignment.submitError')}
        </p>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-xl bg-accent-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-600/90 focus:outline-none focus:ring-2 focus:ring-accent-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
      >
        {isSubmitting ? t('assignment.submitting') : t('assignment.submit')}
      </button>
    </form>
  );
}
