import Modal from '../../../../components/Modal';
import QualificationStatusBadge from './QualificationStatusBadge';
import QualificationHistoryTimeline from './QualificationHistoryTimeline';
import { FileTextIcon } from '../../../shell/components/icons';
import { formatDate } from '../mappers';

function DetailRow({ label, value }) {
  return (
    <div>
      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{label}</p>
      <p className="text-sm text-ink-900 dark:text-text-primary-dark">{value}</p>
    </div>
  );
}

// Detalle de una habilitación individual (skill.md §"DETALLE DE
// HABILITACIÓN"), incluyendo su historial completo. Se abre desde
// AgentQualificationDrawer o EquipmentDetailPanel sin apilar un segundo
// drawer sobre el primero.
export default function QualificationDetailModal({ open, onClose, item, history, historyLoading, onRenew }) {
  if (!item) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item.equipmentName}
      widthClassName="max-w-lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium text-ink-900 hover:bg-black/5 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={() => onRenew(item)}
            className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-600/90"
          >
            Registrar renovación
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
            {item.agentName} · {item.employeeNumber}
          </p>
          <QualificationStatusBadge status={item.status} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <DetailRow label="Fecha de entrenamiento" value={formatDate(item.record.trainingDate)} />
          <DetailRow label="Fecha de obtención" value={formatDate(item.record.obtainedAt)} />
          <DetailRow label="Fecha de vencimiento" value={formatDate(item.record.expiresAt)} />
          <DetailRow label="Entidad certificadora" value={item.record.certifyingEntity} />
          <DetailRow label="Instructor / evaluador" value={item.record.instructor || '—'} />
          <DetailRow label="Terminal" value={item.terminals.join(' / ')} />
        </div>

        <div>
          <p className="mb-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">Observaciones</p>
          <p className="text-sm text-ink-900 dark:text-text-primary-dark">{item.record.notes || 'Sin observaciones.'}</p>
        </div>

        <div>
          <p className="mb-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">Documento de soporte</p>
          {item.record.supportDocument ? (
            <a
              href={item.record.supportDocument.url}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-600 hover:underline"
            >
              <FileTextIcon className="h-4 w-4" /> {item.record.supportDocument.name}
            </a>
          ) : (
            <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">No se adjuntó documento.</p>
          )}
        </div>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
            Historial
          </h4>
          <QualificationHistoryTimeline events={history} loading={historyLoading} />
        </div>
      </div>
    </Modal>
  );
}
