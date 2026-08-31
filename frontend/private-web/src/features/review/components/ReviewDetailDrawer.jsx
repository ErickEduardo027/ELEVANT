import { useEffect, useRef, useState } from 'react';
import ReviewStatusBadge from './ReviewStatusBadge';
import ReviewPriorityBadge from './ReviewPriorityBadge';
import FlightInfoSection from './FlightInfoSection';
import FlightTimeline from './FlightTimeline';
import PlanningVsExecution from './PlanningVsExecution';
import ServiceChecklist from './ServiceChecklist';
import EquipmentList from './EquipmentList';
import IncidentList from './IncidentList';
import ReconciliationDiff from './ReconciliationDiff';
import SignatureStatus from './SignatureStatus';
import EvidenceList from './EvidenceList';
import ObservationList from './ObservationList';
import ReviewHistoryLog from './ReviewHistoryLog';
import ReviewActionBar from './ReviewActionBar';
import ApprovalConfirmation from './ApprovalConfirmation';
import ReturnCorrectionModal from './ReturnCorrectionModal';
import { formatOperationDate } from '../reviewMappers';
import { XIcon } from './icons';

export default function ReviewDetailDrawer({ operation, onClose, onApprove, onReturn }) {
  const [confirmingApproval, setConfirmingApproval] = useState(false);
  const [returningWithCorrection, setReturningWithCorrection] = useState(false);
  const historyRef = useRef(null);

  useEffect(() => {
    setConfirmingApproval(false);
    setReturningWithCorrection(false);
  }, [operation?.id]);

  useEffect(() => {
    if (!operation) return undefined;
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [operation, onClose]);

  if (!operation) return null;

  function handleApproveConfirm() {
    setConfirmingApproval(false);
    onApprove(operation.id);
  }

  function handleReturnConfirm(reason) {
    setReturningWithCorrection(false);
    onReturn(operation.id, reason);
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink-900/40 backdrop-blur-sm transition-opacity duration-200" onClick={onClose} />
      <aside
        data-testid="review-detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-drawer-title"
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-black/5 bg-white/95 shadow-lg backdrop-blur-md transition-transform duration-200 dark:border-white/5 dark:bg-surface-dark-card lg:w-[60%]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-black/5 px-5 py-4 dark:border-white/5">
          <div className="space-y-1.5">
            <p id="review-drawer-title" className="font-mono text-base font-semibold text-ink-900 dark:text-text-primary-dark">
              {operation.flight.number} · {operation.flight.airline}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <ReviewStatusBadge status={operation.status} />
              <ReviewPriorityBadge priority={operation.priority} />
              <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                {formatOperationDate(operation.schedule?.sta)} · Posición {operation.position}
              </span>
            </div>
          </div>
          <button
            type="button"
            aria-label="Cerrar detalle"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-secondary-light hover:bg-black/5 dark:text-text-secondary-dark dark:hover:bg-white/5"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <FlightInfoSection operation={operation} />
          <IncidentList incidents={operation.incidents} />
          <PlanningVsExecution operation={operation} />
          <ReconciliationDiff operation={operation} />
          <FlightTimeline timeline={operation.timeline} />
          <ServiceChecklist services={operation.services} />
          <EquipmentList equipment={operation.equipment} />
          <EvidenceList evidence={operation.evidence} />
          <SignatureStatus operation={operation} />
          <ObservationList observations={operation.observations} />
          <div ref={historyRef}>
            <ReviewHistoryLog history={operation.history} />
          </div>
        </div>

        <ReviewActionBar
          onApproveClick={() => setConfirmingApproval(true)}
          onReturnClick={() => setReturningWithCorrection(true)}
          onViewHistory={() => historyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />
      </aside>

      <ApprovalConfirmation
        open={confirmingApproval}
        count={1}
        onConfirm={handleApproveConfirm}
        onCancel={() => setConfirmingApproval(false)}
      />
      <ReturnCorrectionModal
        open={returningWithCorrection}
        count={1}
        onConfirm={handleReturnConfirm}
        onCancel={() => setReturningWithCorrection(false)}
      />
    </>
  );
}
