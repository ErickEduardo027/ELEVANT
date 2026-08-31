import Drawer from '../../../../components/Drawer';
import Avatar from '../../../../components/Avatar';
import PermitStatusBadge from './PermitStatusBadge';
import AgentPermitStatusBadge from './AgentPermitStatusBadge';
import PermitHistoryTimeline from './PermitHistoryTimeline';
import { FileTextIcon, RefreshCwIcon } from '../../../shell/components/icons';
import { formatDate } from '../mappers';

function DetailRow({ label, value }) {
  return (
    <div>
      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{label}</p>
      <p className="text-sm text-ink-900 dark:text-text-primary-dark">{value}</p>
    </div>
  );
}

// Panel de un único documento (carnet o licencia) dentro del drawer del
// agente. El carnet vencido recibe el mismo acento visual que en la tabla
// (skill.md: bloquea el acceso a rampa); la licencia no.
function DocumentPanel({ item, emphasizeExpired = false, onRenew }) {
  if (!item) return null;
  const isEmphasized = emphasizeExpired && item.status === 'expired';

  return (
    <div
      className={`rounded-xl border p-3 ${
        isEmphasized ? 'border-status-danger/40 bg-status-danger/5' : 'border-black/5 dark:border-white/5'
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <h5 className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{item.typeLabel}</h5>
        <PermitStatusBadge status={item.status} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <DetailRow label="Número" value={item.record.number} />
        <DetailRow label="Emisión" value={formatDate(item.record.issuedAt)} />
        <DetailRow label="Vencimiento" value={formatDate(item.record.expiresAt)} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        {item.record.supportDocument ? (
          <a
            href={item.record.supportDocument.url}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-600 hover:underline"
          >
            <FileTextIcon className="h-3.5 w-3.5" /> {item.record.supportDocument.name}
          </a>
        ) : (
          <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Sin documento de soporte.</span>
        )}
        <button
          type="button"
          onClick={() => onRenew(item)}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs font-medium text-ink-900 hover:bg-black/5 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5"
        >
          <RefreshCwIcon className="h-3.5 w-3.5" /> Renovar
        </button>
      </div>
    </div>
  );
}

// Detalle en drawer del agente (skill.md §"DETALLE"): información del
// agente, carnet, licencia e historial combinado de renovaciones. Reutiliza
// el mismo patrón (Drawer + secciones) que AgentQualificationDrawer de
// Habilitaciones y certificaciones.
export default function AgentPermitDrawer({ open, onClose, agent, history, historyLoading, onRenewDocument }) {
  if (!agent) {
    return <Drawer open={open} onClose={onClose} title="" widthClassName="lg:w-[55%]" />;
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={agent.agentName}
      description={`${agent.employeeNumber} · Terminal ${agent.terminals.join(' / ')}`}
      widthClassName="lg:w-[55%]"
    >
      <div className="mb-4 flex items-center gap-3">
        <Avatar name={agent.agentName} size="lg" />
        <div>
          <AgentPermitStatusBadge status={agent.overallStatus} />
          <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
            Actualizado {formatDate(agent.updatedAt)}
          </p>
        </div>
      </div>

      <div className="space-y-5">
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
            Información del agente
          </h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DetailRow label="Nombre" value={agent.agentName} />
            <DetailRow label="Identificación" value={agent.identificationNumber ?? '—'} />
            <DetailRow label="Código de empleado" value={agent.employeeNumber} />
            <DetailRow label="Terminal" value={agent.terminals.join(' / ')} />
            <DetailRow label="Fecha de ingreso" value={formatDate(agent.hireDate)} />
            <DetailRow label="Última actualización" value={formatDate(agent.updatedAt)} />
          </div>
        </section>

        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
            Documentos
          </h4>
          <div className="space-y-3">
            <DocumentPanel item={agent.carnet} emphasizeExpired onRenew={onRenewDocument} />
            <DocumentPanel item={agent.licencia} onRenew={onRenewDocument} />
          </div>
        </section>

        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
            Historial de renovaciones
          </h4>
          <PermitHistoryTimeline events={history} loading={historyLoading} />
        </section>
      </div>
    </Drawer>
  );
}
