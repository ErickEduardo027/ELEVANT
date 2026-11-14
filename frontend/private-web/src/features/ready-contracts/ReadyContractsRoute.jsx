import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOccStation } from '../admin-occ/useOccStation';
import { OCC_CLASSES } from '../occ-ui/classes';
import { occButtonClass } from '../occ-ui/OccButton';
import OccDataTable from '../occ-ui/OccDataTable';
import OccEmptyState from '../occ-ui/OccEmptyState';
import { OccTextField } from '../occ-ui/OccField';
import OccPlate from '../occ-ui/OccPlate';
import OccToolbar from '../occ-ui/OccToolbar';
import { useTranslation } from '../../i18n/LanguageScope';
import { listOccReadyContracts } from '../../services/occReadyContractsService';
import { stationDate } from '../../services/positionsMapService';
import { readyContractsMessages } from './readyContractsMessages';

// Template D of the design («Registro»): the toolbar with the page title and the operation date, then the contracts of
// that date as a dense list, one row per contract with its services folded under it.
const TITLE_ID = 'ready-contracts-title';
const SLAB = 'rounded-md border border-occ-line bg-occ-panel text-occ-text';
// The 28 px button (44 px on a touch screen) overhangs its cell instead of making the row taller, so it sits on the
// line of the row's text.
const PLAN_LINK = `${occButtonClass({ variant: 'secondary', size: 'sm' })} -my-1 [@media(pointer:coarse)]:-my-3`;
// A service is a quiet tag: the slab's joint and plain text, never the cyan of what can be acted on.
const SERVICE = 'rounded-sm border border-occ-line px-2 py-0.5 text-sm text-occ-text';
const contractIdOf = contract => contract.contractId;

function formatDate(value, locale) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

/**
 * The services of a contract, under its row. They line up with the airline's name, past the row's disclosure (8 px of
 * cell, a 24 px control and its 6 px gap).
 */
function ContractServices({ contract, t }) {
  const labelId = `ready-contract-services-${contract.contractId}`;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-[1.875rem]">
      <span id={labelId} className="text-xs font-medium text-occ-muted">{t('services')}</span>
      {contract.services.length > 0 ? (
        <ul aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
          {contract.services.map(service => <li key={service.code} className={SERVICE}>{service.name}</li>)}
        </ul>
      ) : <span className="text-sm text-occ-muted">{t('noServices')}</span>}
    </div>
  );
}

// The tracks share the room by what their longest text needs, so from 1440 px every cell keeps one line (a long
// airline name may still put its plate under it) and below that the cells wrap instead of scrolling.
function contractColumns(t, locale) {
  const renewalModes = t('renewalModes');
  return [
    {
      key: 'airline', header: t('columns.airline'), width: 'minmax(0,1.1fr)',
      render: contract => (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <strong className="font-semibold">{contract.airlineName}</strong>
          {contract.airlineIataCode ? <OccPlate kind="code">{contract.airlineIataCode}</OccPlate> : null}
        </span>
      ),
    },
    {
      // The code and its version read as one, «CTR-2026-0001 · Versión 2», as the cycle E2E and the tests find them.
      key: 'contract', header: t('columns.contract'), width: 'minmax(0,1fr)',
      render: contract => (
        <span className="min-w-0">
          <span className="font-mono">{contract.contractCode}</span>
          <span className="text-occ-muted">{` · ${t('version', { number: contract.versionNumber })}`}</span>
        </span>
      ),
    },
    {
      key: 'validity', header: t('columns.validity'), width: 'minmax(0,1.15fr)',
      render: contract => (contract.validTo
        ? t('validFromTo', { from: formatDate(contract.validFrom, locale), to: formatDate(contract.validTo, locale) })
        : t('validFromOpen', { from: formatDate(contract.validFrom, locale) })),
    },
    {
      // A mode this screen does not name yet is shown as the server sends it, never as a message key.
      key: 'renewal', header: t('columns.renewal'), width: '6rem',
      render: contract => {
        if (!contract.renewalMode) return <span className="text-occ-muted">{t('renewalUnset')}</span>;
        return Object.hasOwn(renewalModes, contract.renewalMode) ? renewalModes[contract.renewalMode] : contract.renewalMode;
      },
    },
    {
      key: 'flights', header: t('columns.flights'), width: 'minmax(0,1.1fr)',
      render: contract => {
        if (contract.flightsOnDate === 0) return <span className="text-occ-muted">{t('flightsNone')}</span>;
        return contract.flightsOnDate === 1 ? t('flightsOne') : t('flights', { count: contract.flightsOnDate });
      },
    },
    {
      key: 'plan', header: '', width: '8.25rem', align: 'end',
      render: () => <Link href="/admin-occ/planning" className={PLAN_LINK}>{t('plan')}</Link>,
    },
  ];
}

/**
 * «Contratos listos para operar» (ADR-0027): the contracts OCC can plan flights for at PUJ on a date, read from the
 * API. Prices are never shown to OCC. A refusal (403) offers no retry: pressing again would not change the access.
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
  const failed = state.status === 'error';
  // The service's own sentence for the failure (occReadyContractsService), never the server's title.
  const labels = { loading: t('loading'), retry: t('retry'), ...(failed ? { error: state.error.message } : {}) };
  const summary = state.status === 'success'
    ? <span role="status">{contracts.length === 1 ? t('countOne') : t('count', { count: contracts.length })}</span>
    : null;

  // The station is in the status bar of the OCC frame: the page has no badge of its own, nor a line under its title.
  return (
    <section aria-labelledby={TITLE_ID} className="flex min-w-0 flex-col gap-3 text-occ-text">
      <OccToolbar title={t('title')} titleId={TITLE_ID} summary={summary}>
        <OccTextField type="date" label={t('date')} className="w-44" value={date} onChange={event => setDate(event.target.value)} />
      </OccToolbar>
      {station.stationId ? (
        <div className={SLAB}>
          <OccDataTable as="list" caption={t('title')} columns={contractColumns(t, locale)} rows={contracts}
            getRowId={contractIdOf} status={state.status} labels={labels}
            onRetry={failed && state.error.status !== 403 ? retry : undefined}
            emptyState={<OccEmptyState title={t('emptyTitle')} description={t('emptyDescription')} />}
            renderExpanded={contract => <ContractServices contract={contract} t={t} />}
            expandLabel={contract => t('servicesToggle', { count: contract.services.length })} />
        </div>
      ) : <p role="alert" className={`${OCC_CLASSES.card} text-sm`}>{t('noStation')}</p>}
    </section>
  );
}
