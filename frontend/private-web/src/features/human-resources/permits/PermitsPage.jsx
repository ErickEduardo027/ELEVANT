import { useEffect, useState } from 'react';
import { useAppSearchParams as useSearchParams } from '../../../hooks/useAppSearchParams';
import { useAirportPermitsData } from './useAirportPermitsData';
import { usePermitFilters } from './usePermitFilters';
import { useDisclosure } from '../../../hooks/useDisclosure';
import { useToast } from '../../../hooks/useToast';
import Toast from '../../../components/Toast';
import { RefreshCwIcon } from '../../shell/components/icons';
import PermitSummary from './components/PermitSummary';
import PermitFilters from './components/PermitFilters';
import AgentPermitsTable from './components/AgentPermitsTable';
import AgentPermitDrawer from './components/AgentPermitDrawer';
import PermitRenewalModal from './components/PermitRenewalModal';

// Composición del módulo "Carnets y permisos aeroportuarios". La Topbar y
// el Sidebar de Gestión Humana ya existen (AppShell); este componente solo
// aporta el contenido del área principal, igual que CertificationsPage.
// Toda la lectura/escritura de datos pasa por useAirportPermitsData (que a
// su vez delega en humanResourcesPermitsService) — este archivo no importa
// el servicio directamente.
export default function PermitsPage() {
  const { status, agentSummaries, error, kpis, refresh, renewPermitRecord, fetchPermitHistory } = useAirportPermitsData();

  const { filters, onFilterChange, onResetFilters, hasActiveFilters, filteredItems } = usePermitFilters(agentSummaries);
  const { toasts, showToast, dismissToast } = useToast();

  const [searchParams, setSearchParams] = useSearchParams();
  const [appliedDeepLink, setAppliedDeepLink] = useState(false);

  const [activeAgent, setActiveAgent] = useState(null);
  const [activeDocument, setActiveDocument] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const agentDrawer = useDisclosure();
  const renewalModal = useDisclosure();

  const isLoading = status === 'loading';
  const isError = status === 'error';

  // Mantiene el drawer del agente sincronizado tras renovar un documento
  // (refresh() recalcula agentSummaries, ya con identidad/fechas incluidas).
  useEffect(() => {
    if (!activeAgent) return;
    const fresh = agentSummaries.find(item => item.agentId === activeAgent.agentId);
    if (fresh) setActiveAgent(fresh);
  }, [agentSummaries]);

  function loadHistoryFor(agent) {
    const permitIds = [agent.carnet?.id, agent.licencia?.id].filter(Boolean);
    setHistory([]);
    setHistoryLoading(true);
    Promise.all(permitIds.map(fetchPermitHistory))
      .then(results => {
        const merged = results.flat().sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
        setHistory(merged);
      })
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }

  function openAgentDetail(agentId) {
    const summary = agentSummaries.find(item => item.agentId === agentId);
    if (!summary) return;

    setActiveAgent(summary);
    loadHistoryFor(summary);
    agentDrawer.open();
  }

  useEffect(() => {
    const agentId = searchParams.get('agentId');
    if (appliedDeepLink || !agentId || status !== 'success') return;
    openAgentDetail(agentId);
    setAppliedDeepLink(true);
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, appliedDeepLink]);

  function openRenewDocument(item) {
    setActiveDocument(item);
    renewalModal.open();
  }

  async function handleRenewSubmit(item, payload) {
    await renewPermitRecord(item.id, payload);
    showToast(`Renovación registrada — ${item.typeLabel} de ${item.agentName}.`, 'success');
    if (activeAgent) loadHistoryFor(activeAgent);
  }

  if (isError) {
    return (
      <div
        role="alert"
        className="mx-auto flex max-w-[1440px] 3xl:max-w-[1760px] flex-col items-start gap-3 rounded-2xl border border-status-danger/30 bg-white/70 p-6 backdrop-blur-md dark:bg-surface-dark-card"
      >
        <p className="text-sm font-semibold text-status-danger">No fue posible cargar los carnets y permisos.</p>
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {error?.message ?? 'Verifique la conexión e intente nuevamente.'}
        </p>
        <button
          type="button"
          onClick={refresh}
          className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600/90"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] 3xl:max-w-[1760px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
        <div>
          <h1 className="text-lg font-semibold text-ink-900 dark:text-text-primary-dark">Carnets y permisos aeroportuarios</h1>
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
            Carnet aeroportuario y licencia de conducir en rampa, por agente: vigentes, próximos a vencer y vencidos.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          aria-label="Actualizar"
          className="flex items-center gap-1.5 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs font-medium text-ink-900 hover:bg-black/5 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5"
        >
          <RefreshCwIcon className="h-3.5 w-3.5" /> Actualizar
        </button>
      </div>

      <PermitSummary kpis={kpis} loading={isLoading} />

      <PermitFilters filters={filters} onFilterChange={onFilterChange} onResetFilters={onResetFilters} hasActiveFilters={hasActiveFilters} />

      <AgentPermitsTable
        items={filteredItems}
        loading={isLoading}
        hasActiveFilters={hasActiveFilters}
        onRowClick={agent => openAgentDetail(agent.agentId)}
      />

      <AgentPermitDrawer
        open={agentDrawer.isOpen}
        onClose={agentDrawer.close}
        agent={activeAgent}
        history={history}
        historyLoading={historyLoading}
        onRenewDocument={openRenewDocument}
      />

      <PermitRenewalModal open={renewalModal.isOpen} onClose={renewalModal.close} item={activeDocument} onSubmit={handleRenewSubmit} />

      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
