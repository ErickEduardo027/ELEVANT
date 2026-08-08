import { useEffect, useState } from 'react';
import ReviewHeader from './components/ReviewHeader';
import ReviewKPIs from './components/ReviewKPIs';
import ReviewTabs from './components/ReviewTabs';
import ReviewFilters from './components/ReviewFilters';
import ReviewSelectionBar from './components/ReviewSelectionBar';
import ReviewQueueTable from './components/ReviewQueueTable';
import ReviewEmptyState from './components/ReviewEmptyState';
import ReviewSkeleton from './components/ReviewSkeleton';
import ReviewDetailDrawer from './components/ReviewDetailDrawer';
import ApprovalConfirmation from './components/ApprovalConfirmation';
import ReturnCorrectionModal from './components/ReturnCorrectionModal';
import ReviewToastStack from './components/ReviewToast';
import { useReviewFilters } from './useReviewFilters';
import { useReviewSelection } from './useReviewSelection';
import { useReviewToasts } from './useReviewToasts';
import { computeKpis } from './reviewMappers';

const CURRENT_USER_NAME = 'Administrador OCC';

export default function ReviewPage({
  status,
  data,
  error,
  onRetry,
  onApprove,
  onReturn,
  onBulkApprove,
  onBulkReturn,
  forceState = 'default',
}) {
  const [selectedOperationId, setSelectedOperationId] = useState(null);
  const [pendingApproval, setPendingApproval] = useState(null);
  const [pendingReturn, setPendingReturn] = useState(null);
  const [now, setNow] = useState(() => new Date().toISOString());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toISOString()), 30000);
    return () => clearInterval(id);
  }, []);

  const isLoading = status === 'loading' || forceState === 'loading';
  const isError = (status === 'error' && forceState === 'default') || forceState === 'reviewError';

  const operations = forceState === 'reviewEmpty' ? [] : data?.operations ?? [];

  const {
    activeTab,
    setActiveTab,
    filters,
    setFilter,
    resetFilters,
    hasActiveFilters,
    options,
    tabCounts,
    filteredOperations,
  } = useReviewFilters(operations);

  const selection = useReviewSelection();
  const { toasts, pushToast, dismissToast } = useReviewToasts();

  useEffect(() => {
    selection.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const kpis = computeKpis(operations);
  const selectedOperation = operations.find(operation => operation.id === selectedOperationId) ?? null;

  if (isError) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-2xl border border-status-danger/30 bg-white/70 p-6 backdrop-blur-md dark:bg-surface-dark-card"
      >
        <p className="text-sm font-semibold text-status-danger">No se pudo cargar la cola de revisión de la estación.</p>
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {error?.message ?? 'Verifique la conexión e intente nuevamente.'}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600/90"
        >
          Reintentar
        </button>
      </div>
    );
  }

  async function handleDrawerApprove(id) {
    await onApprove(id, { user: CURRENT_USER_NAME });
    pushToast('Operación aprobada correctamente.', 'success');
    setSelectedOperationId(null);
  }

  async function handleDrawerReturn(id, reason) {
    await onReturn(id, { user: CURRENT_USER_NAME, reason });
    pushToast('Operación devuelta con correcciones.', 'info');
    setSelectedOperationId(null);
  }

  async function confirmPendingApproval() {
    const { ids, source } = pendingApproval;
    setPendingApproval(null);
    if (source === 'row') {
      await onApprove(ids[0], { user: CURRENT_USER_NAME });
      pushToast('Operación aprobada correctamente.', 'success');
    } else {
      await onBulkApprove(ids, { user: CURRENT_USER_NAME });
      pushToast(
        ids.length === 1 ? 'Operación aprobada correctamente.' : `${ids.length} operaciones aprobadas correctamente.`,
        'success'
      );
    }
    selection.clear();
  }

  async function confirmPendingReturn(reason) {
    const { ids, source } = pendingReturn;
    setPendingReturn(null);
    if (source === 'row') {
      await onReturn(ids[0], { user: CURRENT_USER_NAME, reason });
      pushToast('Operación devuelta con correcciones.', 'info');
    } else {
      await onBulkReturn(ids, { user: CURRENT_USER_NAME, reason });
      pushToast(
        ids.length === 1 ? 'Operación devuelta con correcciones.' : `${ids.length} operaciones devueltas con correcciones.`,
        'info'
      );
    }
    selection.clear();
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <ReviewHeader onRefresh={onRetry} />

      <ReviewKPIs kpis={kpis} activeTab={activeTab} onSelectTab={setActiveTab} loading={isLoading} />

      <ReviewTabs active={activeTab} onChange={setActiveTab} counts={tabCounts} />

      <ReviewFilters
        filters={filters}
        onFilterChange={setFilter}
        onResetFilters={resetFilters}
        hasActiveFilters={hasActiveFilters}
        options={options}
      />

      <ReviewSelectionBar
        count={selection.selectedCount}
        onApproveSelected={() => setPendingApproval({ ids: selection.selectedIdList, source: 'bulk' })}
        onReturnSelected={() => setPendingReturn({ ids: selection.selectedIdList, source: 'bulk' })}
        onClearSelection={selection.clear}
      />

      {isLoading ? (
        <ReviewSkeleton />
      ) : filteredOperations.length === 0 ? (
        <ReviewEmptyState activeTab={activeTab} hasActiveFilters={hasActiveFilters} />
      ) : (
        <ReviewQueueTable
          operations={filteredOperations}
          now={now}
          selectedIds={selection.selectedIds}
          onToggleSelect={selection.toggle}
          onToggleSelectAll={selection.toggleAll}
          onOpenDetail={setSelectedOperationId}
          onQuickApprove={id => setPendingApproval({ ids: [id], source: 'row' })}
          onQuickReturn={id => setPendingReturn({ ids: [id], source: 'row' })}
        />
      )}

      <ReviewDetailDrawer
        operation={selectedOperation}
        onClose={() => setSelectedOperationId(null)}
        onApprove={handleDrawerApprove}
        onReturn={handleDrawerReturn}
      />

      <ApprovalConfirmation
        open={pendingApproval !== null}
        count={pendingApproval?.ids.length ?? 1}
        onConfirm={confirmPendingApproval}
        onCancel={() => setPendingApproval(null)}
      />
      <ReturnCorrectionModal
        open={pendingReturn !== null}
        count={pendingReturn?.ids.length ?? 1}
        onConfirm={confirmPendingReturn}
        onCancel={() => setPendingReturn(null)}
      />

      <ReviewToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
