import { STATUS_COLORS, getStatusMeta } from '../../dashboard/statusMeta';
import { formatRelativeTime } from '../chatMappers';

function AgentAvatar({ name, status }) {
  const initials = name
    .split(' ')
    .map(part => part[0])
    .slice(0, 2)
    .join('');

  const dotColor = status === 'online' ? '#1E9E6B' : status === 'offline' ? '#94A3B8' : null;

  return (
    <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-900/10 text-xs font-semibold text-ink-900 dark:bg-white/10 dark:text-text-primary-dark">
      {initials}
      {dotColor && (
        <span
          data-testid="agent-presence-dot"
          aria-hidden="true"
          className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-surface-dark-card"
          style={{ backgroundColor: dotColor }}
        />
      )}
    </span>
  );
}

export default function ConversationListItem({ conversation, selected = false, onSelect }) {
  const accentColor = STATUS_COLORS[getStatusMeta('chat', conversation.status).color];
  const unread = conversation.unreadCount > 0;

  return (
    <button
      type="button"
      data-testid="conversation-list-item"
      data-selected={selected}
      onClick={() => onSelect(conversation.id)}
      style={{ borderLeftWidth: 3, borderLeftColor: accentColor }}
      className={`flex w-full items-start gap-3 rounded-xl border border-black/5 px-3 py-3 text-left backdrop-blur-md transition-colors duration-200 dark:border-white/5 ${
        selected
          ? 'bg-accent-600/10 dark:bg-accent-600/15'
          : unread
            ? 'bg-accent-600/5 hover:bg-accent-600/10 dark:bg-accent-600/10 dark:hover:bg-accent-600/15'
            : 'bg-white/70 hover:bg-black/5 dark:bg-surface-dark-card dark:hover:bg-white/5'
      }`}
    >
      <AgentAvatar name={conversation.agentName} status={conversation.agentStatus} />

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
              {conversation.flightNumber}
            </span>
            <span className="truncate text-xs text-text-secondary-light dark:text-text-secondary-dark">{conversation.airline}</span>
            {conversation.requiresAttention && (
              <span
                data-testid="requires-attention-dot"
                aria-label="Requiere atención"
                title="Requiere atención"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-signal-500"
              />
            )}
          </div>
          <span className="shrink-0 whitespace-nowrap text-[11px] text-text-secondary-light dark:text-text-secondary-dark">
            {conversation.lastMessageAt ? formatRelativeTime(conversation.lastMessageAt, new Date().toISOString()) : ''}
          </span>
        </div>

        <p className="truncate text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {conversation.origin} → {conversation.destination}
          {conversation.position ? ` · Pos. ${conversation.position}` : ''} · {conversation.agentName}
        </p>

        <div className="flex items-center justify-between gap-2">
          <p
            className={`truncate text-xs ${
              unread ? 'font-semibold text-ink-900 dark:text-text-primary-dark' : 'text-text-secondary-light dark:text-text-secondary-dark'
            }`}
          >
            {conversation.lastMessage}
          </p>
          {unread && (
            <span
              data-testid="unread-count-badge"
              className="flex h-4 min-w-[1rem] shrink-0 items-center justify-center rounded-full bg-accent-600 px-1 text-[10px] font-semibold text-white"
            >
              {conversation.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
