import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatFilters } from './useChatFilters';

function conversations() {
  return [
    { id: 'a', flightNumber: 'DM161', airline: 'Arajet', agentName: 'Carlos Medina', operationId: 'REV-1', position: 'A5', status: 'active', unreadCount: 2, lastMessageAt: '2026-08-08T09:00:00-04:00' },
    { id: 'b', flightNumber: 'AA904', airline: 'American', agentName: 'María Castillo', operationId: 'REV-2', position: 'B21', status: 'pending', unreadCount: 0, lastMessageAt: '2026-08-08T10:00:00-04:00' },
    { id: 'c', flightNumber: 'B6812', airline: 'JetBlue', agentName: 'José Fermín', operationId: 'REV-3', position: 'A1', status: 'closed', unreadCount: 0, lastMessageAt: '2026-08-07T10:00:00-04:00' },
  ];
}

describe('useChatFilters', () => {
  it('sorts by most recent lastMessageAt by default with no filters active', () => {
    const { result } = renderHook(() => useChatFilters(conversations()));
    expect(result.current.filteredConversations.map(c => c.id)).toEqual(['b', 'a', 'c']);
    expect(result.current.hasActiveFilters).toBe(false);
  });

  it('filters by the unread quick chip', () => {
    const { result } = renderHook(() => useChatFilters(conversations()));
    act(() => result.current.setActiveChip('unread'));
    expect(result.current.filteredConversations.map(c => c.id)).toEqual(['a']);
    expect(result.current.hasActiveFilters).toBe(true);
  });

  it('filters by status chips', () => {
    const { result } = renderHook(() => useChatFilters(conversations()));
    act(() => result.current.setActiveChip('closed'));
    expect(result.current.filteredConversations.map(c => c.id)).toEqual(['c']);
  });

  it('filters by search text across flight/airline/agent/operation/position', () => {
    const { result } = renderHook(() => useChatFilters(conversations()));
    act(() => result.current.setSearch('medina'));
    expect(result.current.filteredConversations.map(c => c.id)).toEqual(['a']);
  });

  it('combines chip and search filters', () => {
    const { result } = renderHook(() => useChatFilters(conversations()));
    act(() => {
      result.current.setActiveChip('pending');
      result.current.setSearch('aa904');
    });
    expect(result.current.filteredConversations.map(c => c.id)).toEqual(['b']);
  });

  it('resetFilters clears both search and chip', () => {
    const { result } = renderHook(() => useChatFilters(conversations()));
    act(() => {
      result.current.setActiveChip('closed');
      result.current.setSearch('jetblue');
    });
    act(() => result.current.resetFilters());
    expect(result.current.search).toBe('');
    expect(result.current.activeChip).toBe('all');
    expect(result.current.hasActiveFilters).toBe(false);
  });

  it('exposes counts by status and unread', () => {
    const { result } = renderHook(() => useChatFilters(conversations()));
    expect(result.current.counts).toEqual({ total: 3, unread: 1, active: 1, pending: 1, closed: 1 });
  });
});
