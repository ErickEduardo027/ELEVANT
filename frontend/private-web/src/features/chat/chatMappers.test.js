import { describe, expect, it } from 'vitest';
import {
  computeConversationCounts,
  formatFileSize,
  formatRelativeTime,
  groupMessagesByDate,
  matchesConversationSearch,
  sortConversationsByRecency,
} from './chatMappers';

const NOW_ISO = '2026-08-08T14:00:00-04:00';

describe('formatRelativeTime', () => {
  it('formats sub-minute gaps as "Justo ahora"', () => {
    expect(formatRelativeTime('2026-08-08T13:59:40-04:00', NOW_ISO)).toBe('Justo ahora');
  });

  it('formats minute and hour gaps', () => {
    expect(formatRelativeTime('2026-08-08T13:55:00-04:00', NOW_ISO)).toBe('hace 5 min');
    expect(formatRelativeTime('2026-08-08T11:00:00-04:00', NOW_ISO)).toBe('hace 3 h');
  });

  it('labels yesterday explicitly', () => {
    expect(formatRelativeTime('2026-08-07T10:00:00-04:00', NOW_ISO)).toBe('ayer');
  });

  it('falls back to a short date for older timestamps', () => {
    expect(formatRelativeTime('2026-07-20T20:00:00-04:00', NOW_ISO)).toBe('jul 20');
  });
});

describe('groupMessagesByDate', () => {
  it('groups messages into Hoy/Ayer/Esta semana buckets in ascending chronological order', () => {
    const messages = [
      { createdAt: '2026-07-25T09:00:00-04:00' },
      { createdAt: '2026-08-07T20:00:00-04:00' },
      { createdAt: '2026-08-08T08:00:00-04:00' },
      { createdAt: '2026-08-08T09:00:00-04:00' },
    ];
    const groups = groupMessagesByDate(messages, NOW_ISO);
    expect(groups.map(g => g.label)).toEqual(['25 de julio', 'Ayer', 'Hoy']);
    expect(groups.find(g => g.label === 'Hoy').items).toHaveLength(2);
  });

  it('returns an empty array for an empty thread', () => {
    expect(groupMessagesByDate([], NOW_ISO)).toEqual([]);
  });
});

describe('matchesConversationSearch', () => {
  const conversation = {
    flightNumber: 'DM161',
    airline: 'Arajet',
    agentName: 'Carlos Medina',
    operationId: 'REV-1001',
    position: 'A5',
  };

  it('matches on flight number, airline, agent, operation and position case-insensitively', () => {
    expect(matchesConversationSearch(conversation, 'dm161')).toBe(true);
    expect(matchesConversationSearch(conversation, 'arajet')).toBe(true);
    expect(matchesConversationSearch(conversation, 'medina')).toBe(true);
    expect(matchesConversationSearch(conversation, 'rev-1001')).toBe(true);
    expect(matchesConversationSearch(conversation, 'a5')).toBe(true);
  });

  it('returns false when nothing matches, and true for an empty query', () => {
    expect(matchesConversationSearch(conversation, 'AA904')).toBe(false);
    expect(matchesConversationSearch(conversation, '')).toBe(true);
  });
});

describe('computeConversationCounts', () => {
  it('tallies totals by status and unread', () => {
    const conversations = [
      { status: 'active', unreadCount: 2 },
      { status: 'pending', unreadCount: 0 },
      { status: 'closed', unreadCount: 0 },
      { status: 'active', unreadCount: 0 },
    ];
    expect(computeConversationCounts(conversations)).toEqual({ total: 4, unread: 1, active: 2, pending: 1, closed: 1 });
  });
});

describe('sortConversationsByRecency', () => {
  it('orders conversations by lastMessageAt descending without mutating the input', () => {
    const conversations = [
      { id: 'a', lastMessageAt: '2026-08-08T08:00:00-04:00' },
      { id: 'b', lastMessageAt: '2026-08-08T12:00:00-04:00' },
      { id: 'c', lastMessageAt: null },
    ];
    const sorted = sortConversationsByRecency(conversations);
    expect(sorted.map(c => c.id)).toEqual(['b', 'a', 'c']);
    expect(conversations.map(c => c.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('formatFileSize', () => {
  it('formats bytes into a human readable size', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(500)).toBe('500 B');
    expect(formatFileSize(842000)).toBe('822.3 KB');
    expect(formatFileSize(210000)).toBe('205.1 KB');
  });
});