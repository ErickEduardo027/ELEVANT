import { useState } from 'react';
import ConversationStatusBadge from './ConversationStatusBadge';
import { ChevronDownIcon } from './icons';

function Field({ label, value }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">{label}</p>
      <p className="truncate text-xs font-medium text-ink-900 dark:text-text-primary-dark">{value}</p>
    </div>
  );
}

export default function OperationContext({ conversation }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="mx-4 mt-3 rounded-xl border border-black/5 bg-white/60 dark:border-white/5 dark:bg-surface-dark-card">
      <button
        type="button"
        onClick={() => setCollapsed(value => !value)}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
          Contexto de la operación
        </span>
        <ChevronDownIcon className={`h-3.5 w-3.5 text-text-secondary-light transition-transform dark:text-text-secondary-dark ${collapsed ? '-rotate-90' : ''}`} />
      </button>

      {!collapsed && (
        <div className="grid grid-cols-2 gap-3 px-3 pb-3 sm:grid-cols-4">
          <Field label="Vuelo" value={conversation.flightNumber} />
          <Field label="Posición" value={conversation.position ?? 'Sin asignar'} />
          <Field label="Agente" value={conversation.agentName} />
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">Estado</p>
            <ConversationStatusBadge status={conversation.status} />
          </div>
        </div>
      )}
    </div>
  );
}
