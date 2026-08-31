import Drawer from '../../../../components/Drawer';
import Avatar from '../../../../components/Avatar';
import EmptyState from '../../../../components/EmptyState';
import AgentStatusBadge from './AgentStatusBadge';
import QualificationStatusBadge from './QualificationStatusBadge';
import { PlusIcon, ShieldCheckIcon } from '../../../shell/components/icons';
import { formatDate } from '../mappers';

function DetailRow({ label, value }) {
  return (
    <div>
      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{label}</p>
      <p className="text-sm text-ink-900 dark:text-text-primary-dark">{value}</p>
    </div>
  );
}

// Detalle en drawer del agente (skill.md §"DETALLE DEL AGENTE"): información
// del agente, resumen y tabla anidada de sus habilitaciones. Es la versión
// gestionable de lo que hoy solo se enuncia en el tab "Habilitaciones" de
// UserDetailPanel (Gestión de usuarios).
export default function AgentQualificationDrawer({ open, onClose, agent, onAddQualification, onViewQualification, onRenewQualification }) {
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
          <AgentStatusBadge status={agent.overallStatus} />
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
            Resumen
          </h4>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-black/5 p-3 dark:border-white/5">
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Total</p>
              <p className="font-mono text-lg font-semibold text-ink-900 dark:text-text-primary-dark">{agent.qualifications.length}</p>
            </div>
            <div className="rounded-xl border border-black/5 p-3 dark:border-white/5">
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Vigentes</p>
              <p className="font-mono text-lg font-semibold text-status-success">{agent.activeCount}</p>
            </div>
            <div className="rounded-xl border border-black/5 p-3 dark:border-white/5">
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Próximas</p>
              <p className="font-mono text-lg font-semibold text-status-warning">{agent.expiringSoonCount}</p>
            </div>
            <div className="rounded-xl border border-black/5 p-3 dark:border-white/5">
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Vencidas</p>
              <p className="font-mono text-lg font-semibold text-status-danger">{agent.expiredCount}</p>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
              Habilitaciones
            </h4>
            <button
              type="button"
              onClick={() => onAddQualification(agent)}
              className="flex items-center gap-1.5 rounded-lg bg-accent-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-accent-600/90"
            >
              <PlusIcon className="h-3.5 w-3.5" /> Agregar habilitación
            </button>
          </div>

          {agent.qualifications.length === 0 ? (
            <EmptyState
              icon={ShieldCheckIcon}
              title="Sin habilitaciones registradas"
              description="Agrega la primera habilitación de este agente."
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-black/5 dark:border-white/5">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-black/5 text-xs font-medium uppercase tracking-wide text-text-secondary-light dark:border-white/5 dark:text-text-secondary-dark">
                    <th className="px-3 py-2">Equipo</th>
                    <th className="px-3 py-2">Estado</th>
                    <th className="hidden px-3 py-2 sm:table-cell">Obtención</th>
                    <th className="px-3 py-2">Vencimiento</th>
                    <th className="hidden px-3 py-2 md:table-cell">Entidad</th>
                    <th className="px-3 py-2 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5 dark:divide-white/5">
                  {agent.qualifications.map(item => (
                    <tr key={item.id} className={item.status === 'expired' ? 'bg-status-danger/[0.03]' : ''}>
                      <td className="px-3 py-2.5 text-ink-900 dark:text-text-primary-dark">{item.equipmentName}</td>
                      <td className="px-3 py-2.5">
                        <QualificationStatusBadge status={item.status} />
                      </td>
                      <td className="hidden px-3 py-2.5 text-text-secondary-light dark:text-text-secondary-dark sm:table-cell">
                        {formatDate(item.record.obtainedAt)}
                      </td>
                      <td className="px-3 py-2.5 text-text-secondary-light dark:text-text-secondary-dark">{formatDate(item.record.expiresAt)}</td>
                      <td className="hidden px-3 py-2.5 text-text-secondary-light dark:text-text-secondary-dark md:table-cell">
                        {item.record.certifyingEntity}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => onViewQualification(item)} className="text-xs font-medium text-accent-600 hover:underline">
                            Detalle
                          </button>
                          <button type="button" onClick={() => onRenewQualification(item)} className="text-xs font-medium text-accent-600 hover:underline">
                            Renovar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Drawer>
  );
}
