import { useMemo, useState } from 'react';
import { computeConversationCounts, matchesConversationSearch, sortConversationsByRecency } from './chatMappers';

export function useChatFilters(conversations) {
  const [search, setSearch] = useState('');
  const [activeChip, setActiveChip] = useState('all');

  const filteredConversations = useMemo(() => {
    const sorted = sortConversationsByRecency(conversations);
    return sorted.filter(conversation => {
      if (activeChip === 'unread' && conversation.unreadCount === 0) return false;
      if (activeChip === 'active' && conversation.status !== 'active') return false;
      if (activeChip === 'pending' && conversation.status !== 'pending') return false;
      if (activeChip === 'closed' && conversation.status !== 'closed') return false;
      if (!matchesConversationSearch(conversation, search)) return false;
      return true;
    });
  }, [conversations, activeChip, search]);

  const hasActiveFilters = search !== '' || activeChip !== 'all';

  function resetFilters() {
    setSearch('');
    setActiveChip('all');
  }

  const counts = useMemo(() => computeConversationCounts(conversations), [conversations]);

  return { search, setSearch, activeChip, setActiveChip, resetFilters, hasActiveFilters, filteredConversations, counts };
}
