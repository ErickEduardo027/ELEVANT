import { formatRelativeTime } from '../chatMappers';
import ConversationStatusBadge from './ConversationStatusBadge';
import { ArrowLeftIcon } from './icons';

function AgentPresence({ status, lastSeenAt, nowIso }) {
  if (status === 'online') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-status-success">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-status-success" />
        En línea
      </span>
    );
  }
  if (status === 'offline') {
    return (
      <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
        {lastSeenAt ? `Última conexión ${formatRelativeTime(lastSeenAt, nowIso)}` : 'Desconectado'}
      </span>
    );
  }
  return null;
}

export default function ChatHeader({ conversation, onBack, onViewFlight, onViewOperation, showBack = false }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-black/5 px-4 py-3 dark:border-white/5">
      <div className="flex min-w-0 items-start gap-2">
        {showBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Volver a la lista de conversaciones"
            className="mt-0.5 rounded-md p-1 text-text-secondary-light hover:bg-black/5 dark:text-text-secondary-dark dark:hover:bg-white/5"
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
              {conversation.flightNumber}
            </span>
            <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{conversation.airline}</span>
            <ConversationStatusBadge status={conversation.status} />
          </div>
          <p className="truncate text-xs text-text-secondary-light dark:text-text-secondary-dark">
            {conversation.origin} → {conversation.destination}
            {conversation.position ? ` · Posición ${conversation.position}` : ''} · {conversation.agentName}
          </p>
          <AgentPresence status={conversation.agentStatus} lastSeenAt={conversation.agentLastSeenAt} nowIso={new Date().toISOString()} />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => onViewFlight(conversation.flightId)}
          className="rounded-lg border border-black/10 px-2.5 py-1.5 text-xs font-semibold text-ink-900 hover:bg-black/5 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5"
        >
          Ver vuelo
        </button>
        <button
          type="button"
          onClick={() => onViewOperation(conversation.operationId)}
          className="rounded-lg border border-black/10 px-2.5 py-1.5 text-xs font-semibold text-ink-900 hover:bg-black/5 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5"
        >
          Ver operación
        </button>
      </div>
    </div>
  );
}
