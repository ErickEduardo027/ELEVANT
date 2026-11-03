import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { OccStationBadge } from '../admin-occ/OccQueueState';
import { useOccStation } from '../admin-occ/useOccStation';
import { useTranslation } from '../../i18n/LanguageScope';
import { listOccReadyContracts } from '../../services/occReadyContractsService';
import { stationDate } from '../../services/positionsMapService';
import { readyContractsMessages } from './readyContractsMessages';

const cardClass = 'rounded-2xl border border-black/5 bg-white/80 p-5 dark:border-white/5 dark:bg-surface-dark-card';

function formatDate(value, locale) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

function ContractCard({ contract, t, locale }) {
  const flights = contract.flightsOnDate === 0 ? t('flightsNone')
    : contract.flightsOnDate === 1 ? t('flightsOne') : t('flights', { count: contract.flightsOnDate });
  return (
    <li className={`${cardClass} space-y-3`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold">{contract.airlineName}
            {contract.airlineIataCode && <span className="ml-2 font-mono text-xs text-accent-600">{contract.airlineIataCode}</span>}</p>
          <p className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
            {t('contract')} {contract.contractCode} · {t('version', { number: contract.versionNumber })}</p>
        </div>
        <Link href="/admin-occ/planning"
          className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-accent-600/40 px-3 text-xs font-semibold text-accent-600">
          {t('plan')}</Link>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-xs">
        <div><dt className="text-text-secondary-light dark:text-text-secondary-dark">{t('validity')}</dt>
          <dd>{t('validFromTo', { from: formatDate(contract.validFrom, locale),
            to: contract.validTo ? formatDate(contract.validTo, locale) : t('openEnded') })}</dd></div>
        <div><dt className="text-text-secondary-light dark:text-text-secondary-dark">{t('renewal')}</dt>
          <dd>{contract.renewalMode ? t(`renewalModes.${contract.renewalMode}`) : t('renewalUnset')}</dd></div>
      </dl>
      <div className="text-xs">
        <p className="text-text-secondary-light dark:text-text-secondary-dark">{t('services')}</p>
        {contract.services.length ? <ul className="mt-1 flex flex-wrap gap-1.5">
          {contract.services.map(service => <li key={service.code}
            className="rounded-md bg-accent-600/10 px-2 py-0.5 text-accent-600">{service.name}</li>)}
        </ul> : <p>{t('noServices')}</p>}
      </div>
      <p className="text-xs font-medium">{flights}</p>
    </li>
  );
}

/**
 * «Contratos listos para operar» (ADR-0027): the contracts OCC can plan flights for at PUJ on a
 * date, read from the API. Prices are never shown to OCC.
 */
export default function ReadyContractsRoute() {
  const { t, locale } = useTranslation(readyContractsMessages);
  const station = useOccStation();
  const [date, setDate] = useState(() => stationDate());
  const [result, setResult] = useState({ key: '' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!station.stationId || !date) return undefined;
    const controller = new AbortController();
    const key = `${station.stationId}|${date}|${attempt}`;
    listOccReadyContracts(station.stationId, date, { signal: controller.signal })
      .then(data => setResult({ key, status: data.contracts.length ? 'success' : 'empty', data }))
      .catch(error => { if (error?.name !== 'AbortError') setResult({ key, status: 'error', error }); });
    return () => controller.abort();
  }, [station.stationId, date, attempt]);

  // A result for an older station, date or attempt means the current request is still loading.
  const state = result.key === `${station.stationId}|${date}|${attempt}` ? result : { status: 'loading' };
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const contracts = state.data?.contracts ?? [];

  let body;
  if (!station.stationId) body = <p role="alert" className={cardClass}>{t('noStation')}</p>;
  else if (state.status === 'loading') body = <p role="status" className={cardClass}>{t('loading')}</p>;
  else if (state.status === 'error') body = <div role="alert" className={`${cardClass} flex flex-wrap items-center gap-3`}>
    <p>{state.error.message}</p>
    {state.error.status !== 403 && <button type="button" onClick={retry}
      className="min-h-11 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">{t('retry')}</button>}
  </div>;
  else if (state.status === 'empty') body = <p role="status" className={cardClass}>{t('empty')}</p>;
  else body = <>
    <p role="status" className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
      {contracts.length === 1 ? t('countOne') : t('count', { count: contracts.length })}</p>
    <ul className="grid gap-4 md:grid-cols-2" aria-label={t('title')}>
      {contracts.map(contract => <ContractCard key={contract.contractId} contract={contract} t={t} locale={locale} />)}
    </ul>
  </>;

  return (
    <section className="mx-auto max-w-[1200px] space-y-4" aria-labelledby="ready-contracts-title">
      <header className={`${cardClass} flex flex-wrap items-end justify-between gap-4`}>
        <div className="space-y-2">
          <h1 id="ready-contracts-title" className="text-lg font-semibold">{t('title')}</h1>
          <p className="max-w-2xl text-sm text-text-secondary-light dark:text-text-secondary-dark">{t('subtitle')}</p>
          <OccStationBadge />
        </div>
        <label className="text-sm">{t('date')}
          <input type="date" value={date} onChange={event => setDate(event.target.value)}
            className="mt-1 block min-h-11 rounded-lg border border-black/10 bg-white px-3 dark:border-white/10 dark:bg-surface-dark-card" />
        </label>
      </header>
      {body}
    </section>
  );
}
