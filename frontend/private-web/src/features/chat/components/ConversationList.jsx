import ConversationListItem from './ConversationListItem';

export default function ConversationList({ conversations, selectedId, onSelect, emptyMessage }) {
  if (conversations.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-10 text-center text-xs text-text-secondary-light dark:text-text-secondary-dark">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div data-testid="conversation-list" className="flex-1 space-y-1.5 overflow-y-auto">
      {conversations.map(conversation => (
        <ConversationListItem
          key={conversation.id}
          conversation={conversation}
          selected={conversation.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
