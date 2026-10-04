import { useEffect, useState } from 'react';
import { useAppSearchParams as useSearchParams } from '../../../hooks/useAppSearchParams';
import { useQualificationsData } from './useQualificationsData';
import { useQualificationFilters } from './useQualificationFilters';
import { useDisclosure } from '../../../hooks/useDisclosure';
import { useToast } from '../../../hooks/useToast';
import Toast from '../../../components/Toast';
import Tabs from '../../../components/Tabs';
import { PlusIcon, RefreshCwIcon } from '../../shell/components/icons';
import { AGENT_OVERALL_STATUS_META } from './statusMeta';
import QualificationSummary from './components/QualificationSummary';
import QualificationFilters from './components/QualificationFilters';
import AgentQualificationsTable from './components/AgentQualificationsTable';
import AgentQualificationDrawer from './components/AgentQualificationDrawer';
import QualificationFormDrawer from './components/QualificationFormDrawer';
import QualificationDetailModal from './components/QualificationDetailModal';
import QualificationRenewalModal from './components/QualificationRenewalModal';
import EquipmentCoverageView from './components/EquipmentCoverageView';
import EquipmentDetailPanel from './components/EquipmentDetailPanel';

const TABS = [
  { id: 'agents', label: 'Por agente' },
  { id: 'equipment', label: 'Por tipo de equipo' },
];

// Composición del módulo "Habilitaciones y certificaciones". La Topbar y el
// Sidebar de Gestión Humana ya existen (AppShell); este componente solo
// aporta el contenido del área principal, igual que DashboardPage/UsersPage.
// Toda la lectura/escritura de datos pasa por useQualificationsData (que a
// su vez delega en humanResourcesQualificationsService) — este archivo no
// importa el servicio directamente.
export default function CertificationsPage() {
  const {
    status,
    agentSummaries,
    equipmentCoverage,
    agents,
    equipmentCatalog,
    error,
    kpis,
    refresh,
    createQualificationRecord,
    renewQualificationRecord,
    fetchQualificationHistory,
  } = useQualificationsData();

  const { filters, onFilterChange, onResetFilters, hasActiveFilters, filteredItems, sortBy, onSortChange } = useQualificationFilters(agentSummaries);
  const { toasts, showToast, dismissToast } = useToast();

  const [searchParams, setSearchParams] = useSearchParams();
  const [appliedDeepLink, setAppliedDeepLink] = useState(false);

  const [activeTab, setActiveTab] = useState('agents');
  const [activeAgent, setActiveAgent] = useState(null);
  const [activeQualification, setActiveQualification] = useState(null);
  const [activeEquipment, setActiveEquipment] = useState(null);
  const [formDefaultAgentId, setFormDefaultAgentId] = useState(null);
  const [qualificationHistory, setQualificationHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const agentDrawer = useDisclosure();
  const formDrawer = useDisclosure();
  const detailModal = useDisclosure();
  const renewalModal = useDisclosure();
  const equipmentDrawer = useDisclosure();

  const isLoading = status === 'loading';
  const isError = status === 'error';

  // Mantiene el drawer del agente sincronizado tras crear/renovar una
  // habilitación (refresh() recalcula agentSummaries); conserva los campos
  // de identidad que solo vienen del catálogo de agentes.
  useEffect(() => {
    if (!activeAgent) return;
    const fresh = agentSummaries.find(item => item.agentId === activeAgent.agentId);
    if (fresh) setActiveAgent(current => ({ ...fresh, identificationNumber: current.identificationNumber, hireDate: current.hireDate }));
  }, [agentSummaries]);

  useEffect(() => {
    if (!activeEquipment) return;
    const fresh = equipmentCoverage.find(item => item.equipmentId === activeEquipment.equipmentId);
    if (fresh) setActiveEquipment(fresh);
  }, [equipmentCoverage]);

  function openAgentDetail(agentId) {
    equipmentDrawer.close();
    const summary = agentSummaries.find(item => item.agentId === agentId);
    const catalogAgent = agents.find(item => item.agentId === agentId);
    if (!summary && !catalogAgent) return;

    const overallMeta = AGENT_OVERALL_STATUS_META.current;
    const merged = summary
      ? { ...summary, identificationNumber: catalogAgent?.identificationNumber, hireDate: catalogAgent?.hireDate }
      : {
          ...catalogAgent,
          activeCount: 0,
          expiringSoonCount: 0,
          expiredCount: 0,
          nextExpirationAt: null,
          overallStatus: 'current',
          overallStatusLabel: overallMeta.label,
          overallStatusTone: overallMeta.tone,
          updatedAt: null,
          qualifications: [],
        };

    setActiveAgent(merged);
    agentDrawer.open();
  }

  useEffect(() => {
    const agentId = searchParams.get('agentId');
    if (appliedDeepLink || !agentId || status !== 'success') return;
    setActiveTab('agents');
    openAgentDetail(agentId);
    setAppliedDeepLink(true);
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, appliedDeepLink]);

  function openAddQualification(agent = null) {
    setFormDefaultAgentId(agent?.agentId ?? null);
    formDrawer.open();
  }

  function openViewQualification(item) {
    setActiveQualification(item);
    setQualificationHistory([]);
    setHistoryLoading(true);
    fetchQualificationHistory(item.id)
      .then(setQualificationHistory)
      .catch(() => setQualificationHistory([]))
      .finally(() => setHistoryLoading(false));
    detailModal.open();
  }

  function openRenewFromDrawer(item) {
    setActiveQualification(item);
    renewalModal.open();
  }

  function openRenewFromDetail(item) {
    detailModal.close();
    setActiveQualification(item);
    renewalModal.open();
  }

  function openEquipmentDetail(coverage) {
    setActiveEquipment(coverage);
    equipmentDrawer.open();
  }

  function openAgentFromEquipment(agentId) {
    equipmentDrawer.close();
    openAgentDetail(agentId);
  }

  async function handleCreateSubmit(payload) {
    await createQualificationRecord(payload);
    showToast('Habilitación registrada correctamente.', 'success');
  }

  async function handleRenewSubmit(item, payload) {
    await renewQualificationRecord(item.id, payload);
    showToast(`Renovación registrada — ${item.equipmentName}.`, 'success');
  }

  if (isError) {
    return (
      <div
        role="alert"
        className="mx-auto flex max-w-[1440px] flex-col items-start gap-3 rounded-2xl border border-status-danger/30 bg-white/70 p-6 backdrop-blur-md dark:bg-surface-dark-card"
      >
        <p className="text-sm font-semibold text-status-danger">No fue posible cargar las habilitaciones.</p>
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

  const equipmentOptions = equipmentCatalog.map(equipment => ({ value: equipment.id, label: equipment.name }));

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
        <div>
          <h1 className="text-lg font-semibold text-ink-900 dark:text-text-primary-dark">Habilitaciones y certificaciones</h1>
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
            Habilitaciones por agente, cobertura por tipo de equipo y vencimientos: vigentes, próximos a vencer y vencidos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            aria-label="Actualizar"
            className="flex items-center gap-1.5 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs font-medium text-ink-900 hover:bg-black/5 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5"
          >
            <RefreshCwIcon className="h-3.5 w-3.5" /> Actualizar
          </button>
          <button
            type="button"
            onClick={() => openAddQualification(null)}
            className="flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white hover:bg-accent-600/90"
          >
            <PlusIcon className="h-4 w-4" /> Agregar habilitación
          </button>
        </div>
      </div>

      <QualificationSummary kpis={kpis} loading={isLoading} />

      <Tabs tabs={TABS} activeId={activeTab} onChange={setActiveTab} />

      <div key={activeTab} className="animate-fade-in space-y-4">
        {activeTab === 'agents' ? (
          <>
            <QualificationFilters
              filters={filters}
              onFilterChange={onFilterChange}
              onResetFilters={onResetFilters}
              hasActiveFilters={hasActiveFilters}
              equipmentOptions={equipmentOptions}
              sortBy={sortBy}
              onSortChange={onSortChange}
            />
            <AgentQualificationsTable
              items={filteredItems}
              loading={isLoading}
              hasActiveFilters={hasActiveFilters}
              onRowClick={agent => openAgentDetail(agent.agentId)}
            />
          </>
        ) : (
          <EquipmentCoverageView coverage={equipmentCoverage} loading={isLoading} onSelectEquipment={openEquipmentDetail} />
        )}
      </div>

      <AgentQualificationDrawer
        open={agentDrawer.isOpen}
        onClose={agentDrawer.close}
        agent={activeAgent}
        onAddQualification={openAddQualification}
        onViewQualification={openViewQualification}
        onRenewQualification={openRenewFromDrawer}
      />

      <EquipmentDetailPanel
        open={equipmentDrawer.isOpen}
        onClose={equipmentDrawer.close}
        coverage={activeEquipment}
        onOpenAgent={openAgentFromEquipment}
      />

      <QualificationFormDrawer
        open={formDrawer.isOpen}
        onClose={formDrawer.close}
        agents={agents}
        equipmentCatalog={equipmentCatalog}
        defaultAgentId={formDefaultAgentId}
        onSubmit={handleCreateSubmit}
      />

      <QualificationDetailModal
        open={detailModal.isOpen}
        onClose={detailModal.close}
        item={activeQualification}
        history={qualificationHistory}
        historyLoading={historyLoading}
        onRenew={openRenewFromDetail}
      />

      <QualificationRenewalModal
        open={renewalModal.isOpen}
        onClose={renewalModal.close}
        item={activeQualification}
        onSubmit={handleRenewSubmit}
      />

      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
