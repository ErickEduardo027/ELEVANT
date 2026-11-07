import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCommercialRevalidation } from '../../../hooks/useCommercialRevalidation';
import { billingUnitLabel } from '../../../services/billingUnits';
import { getManagedContracts } from '../../../services/commercialGovernanceApi';
import { contractStatusLabel } from '../contractStatus';
import ContractDetailDrawer from './ContractDetailDrawer';

const TITLES = {
  contracts: ['Contratos', 'Versiones aprobadas y cobertura registrada.'],
  services: ['Servicios pactados', 'Tarifas aprobadas por contrato y estación.'],
  reports: ['Reportes contractuales', 'Indicadores de los acuerdos publicados en esta página.'],
};

function date(value) {
  return value ? new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium', timeZone: 'UTC' })
    .format(new Date(`${value}T12:00:00Z`)) : 'Sin vencimiento';
}

export default function ManagedAgreementsPage({ mode = 'contracts', canSign = false, canManageLifecycle = false,
  canSetValidity = false, canAmend = false, onOpenDrafts, onNewContract }) {
  const [detailId, setDetailId] = useState(null);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ status: 'loading', result: null, error: '' });
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useCommercialRevalidation(refresh);

  useEffect(() => {
    let active = true;
    setState(current => ({ ...current, status: 'loading', error: '' }));
    getManagedContracts(page).then(result => {
      if (active) setState({ status: 'success', result, error: '' });
    }).catch(error => {
      if (active) setState({ status: error?.status === 401 ? 'unauthorized' :
        error?.status === 403 ? 'forbidden' : 'error', result: null,
        error: error?.status === 401 ? 'La sesión expiró. Vuelva a iniciar sesión.' :
          error?.status === 403 ? 'No tiene permiso para consultar acuerdos.' :
            'No se pudieron consultar los acuerdos. Intente de nuevo.' });
    });
    return () => { active = false; };
  }, [page, revision]);

  const contracts = state.result?.contracts ?? [];
  const rates = useMemo(() => contracts.flatMap(contract => contract.approvedVersions.flatMap(
    version => version.rates.map(rate => ({ ...rate, contract, version })))), [contracts]);
  const [title, description] = TITLES[mode] ?? TITLES.contracts;

  return <div className="mx-auto max-w-[1440px] 3xl:max-w-[1760px] space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Gestión contractual</p>
        <h1 className="mt-1 text-2xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">{description}</p></div>
      <div className="flex flex-wrap gap-2">
        {mode === 'contracts' && onNewContract && <button type="button" onClick={onNewContract}
          className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Nuevo contrato desde solicitud</button>}
        <button type="button" onClick={refresh} className="rounded-lg border border-black/10 px-4 py-2 text-sm dark:border-white/10">Recargar</button>
      </div>
    </header>
    {mode === 'contracts' && <p className="rounded-xl border border-accent-600/20 bg-accent-600/5 p-4 text-sm">
      Todo contrato nace de una solicitud comercial aprobada: <strong>Solicitudes</strong> → <strong>Borradores</strong> (términos y tarifas)
      → aprobación de precios de <strong>Finanzas</strong> → contrato aprobado. Desde el detalle se descarga el PDF y firman AVIAM y la aerolínea.
    </p>}
    {['error', 'forbidden', 'unauthorized'].includes(state.status) ? <div role="alert" className="rounded-xl border border-status-danger/30 p-5">
      <p>{state.error}</p>{state.status === 'error' && <button type="button" onClick={refresh} className="mt-3 text-accent-600">Reintentar</button>}
    </div> : state.status === 'loading' ? <p role="status" className="rounded-xl border p-5">Cargando acuerdos…</p> : <>
      {mode === 'contracts' && (contracts.length ? <div className="space-y-3">{contracts.map(contract =>
        <article key={contract.id} className="rounded-xl border border-black/5 bg-white p-5 dark:border-white/10 dark:bg-surface-dark-card">
          <div className="flex flex-wrap items-start justify-between gap-3"><div>
            <p className="font-mono text-xs text-accent-600">{contract.code}</p>
            <h2 className="mt-1 font-semibold">{contract.airline}</h2>
            <p className="text-xs text-text-secondary-light">{contract.airlineCode} · {contractStatusLabel(contract.status)}</p>
          </div><span className="text-xs text-text-secondary-light">{contract.approvedVersions.length} versiones publicadas</span></div>
          {contract.approvedVersions.map(version => <div key={version.id} className="mt-3 border-t border-black/5 pt-3 text-sm dark:border-white/10">
            <p>Versión {version.versionNumber} · {version.status === 'Superseded' ? 'Reemplazada' : 'Aprobada'} · {date(version.validFrom)} — {date(version.validTo)} · {version.currencyCode}</p>
            <p className="mt-1 text-xs text-text-secondary-light">Estaciones: {version.stations.map(station => <span key={station.id} className="mr-2">{station.code}</span>)}</p>
            <div className="mt-1 flex flex-wrap items-center gap-3"><p className="text-xs text-text-secondary-light">{version.rates.length} tarifas pactadas</p>
              <button type="button" onClick={() => setDetailId(version.id)} className="text-xs font-semibold text-accent-600 underline">
                Ver detalle, PDF y firmas · versión {version.versionNumber}</button></div>
          </div>)}</article>)}</div> : <p className="rounded-xl border p-8 text-center">No hay contratos aprobados en esta página.</p>)}
      {mode === 'services' && (rates.length ? <div className="overflow-x-auto rounded-xl border border-black/5 bg-white dark:border-white/10 dark:bg-surface-dark-card"><table className="table-stack w-full min-w-[760px] text-left text-sm">
        <thead className="bg-black/[.03] text-xs uppercase dark:bg-white/[.03]"><tr><th className="p-3">Servicio</th><th className="p-3">Contrato</th><th className="p-3">Tarifa</th><th className="p-3">Estaciones</th><th className="p-3">Versión</th><th className="p-3">Vigencia</th></tr></thead>
        <tbody>{rates.map(rate => <tr key={`${rate.version.id}-${rate.id}`} className="border-t border-black/5 dark:border-white/10">
          <td className="p-3"><strong>{rate.serviceName}</strong><span className="block text-xs">{rate.serviceCode}</span></td>
          <td className="p-3">{rate.contract.code}<span className="block text-xs">{rate.contract.airline}</span></td>
          <td className="p-3">{rate.version.currencyCode} {Number(rate.unitPrice).toFixed(4)}<span className="block text-xs">Por {billingUnitLabel(rate.billingUnit)} · mínimo {rate.minimumQuantity}</span></td>
          <td className="p-3">{rate.version.stations.map(station => station.code).join(', ') || 'Sin estación'}</td>
          <td className="p-3">{rate.version.status === 'Superseded' ? 'Reemplazada' : 'Aprobada'}</td>
          <td className="p-3">{date(rate.version.validFrom)} — {date(rate.version.validTo)}</td>
        </tr>)}</tbody></table></div> : <p className="rounded-xl border p-8 text-center">No hay servicios pactados en esta página.</p>)}
      {mode === 'reports' && <section className="rounded-xl border border-black/5 bg-white p-5 dark:border-white/10 dark:bg-surface-dark-card">
        <p className="text-xs text-text-secondary-light">Indicadores de la página {page}, no del total histórico.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3"><p>Contratos: <strong>{contracts.length}</strong></p>
          <p>Activos: <strong>{contracts.filter(contract => contract.status === 'Active').length}</strong></p>
          <p>Tarifas publicadas: <strong>{rates.length}</strong></p></div>
        {contracts.length === 0 && <p className="mt-4">No hay acuerdos publicados en esta página.</p>}
      </section>}
      <nav aria-label="Páginas de acuerdos" className="flex items-center justify-between text-sm">
        <button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Página anterior</button>
        <span>Página {page}</span>
        <button type="button" disabled={!state.result?.hasMore} onClick={() => setPage(value => value + 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Siguiente página</button>
      </nav>
    </>}
    <ContractDetailDrawer versionId={detailId} canSign={canSign} canManageLifecycle={canManageLifecycle} canSetValidity={canSetValidity}
      canAmend={canAmend} onOpenDrafts={onOpenDrafts} onClose={() => setDetailId(null)} onSigned={refresh} />
  </div>;
}
