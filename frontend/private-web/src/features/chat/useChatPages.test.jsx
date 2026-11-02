import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mergeChatPage, useChatPages } from './useChatPages';

describe('chat page merging', () => {
  it('preserves server chronology including timestamp ties and deduplicates canonical IDs', () => {
    const first = [{ id: 'z', content: 'older' }, { id: 'a', content: 'newer' }];
    expect(mergeChatPage(first, [{ id: 'a', content: 'confirmed' }, { id: 'b' }], { messages: true })).toEqual([{ id: 'z', content: 'older' }, { id: 'a', content: 'confirmed' }, { id: 'b' }]);
    expect(mergeChatPage(first, [{ id: 'q' }, { id: 'z', content: 'older' }], { messages: true, older: true }).map(item => item.id)).toEqual(['q', 'z', 'a']);
  });
  it('appends subsequent authorized conversation pages without reordering the first page', () => {
    expect(mergeChatPage([{ operationId: 'z' }, { operationId: 'a' }], [{ operationId: 'a' }, { operationId: 'b' }], { older: true }).map(item => item.operationId)).toEqual(['z', 'a', 'b']);
  });
  it('keeps a confirmed send after older messages when an earlier poll returns late', () => {
    const first = { id: 'first', sentAt: '2026-10-29T10:00:00Z' };
    const sent = { id: 'sent', sentAt: '2026-10-29T10:01:00Z' };
    const confirmed = mergeChatPage([first], [sent], { messages: true });
    const refreshed = mergeChatPage(confirmed, [{ ...first, content: 'from earlier poll' }], { messages: true });
    expect(refreshed.map(item => item.id)).toEqual(['first', 'sent']);
    expect(refreshed[0].content).toBe('from earlier poll');
  });
  it('updates an idempotent POST result without moving its existing message', () => {
    const current = [{ id: 'first' }, { id: 'retry', content: 'original' }, { id: 'later' }];
    const result = mergeChatPage(current, [{ id: 'retry', content: 'confirmed' }], { messages: true });
    expect(result).toEqual([{ id: 'first' }, { id: 'retry', content: 'confirmed' }, { id: 'later' }]);
  });
  it('inserts a late POST response before a newer message without using UUID order for timestamp ties', () => {
    const current = [{ id: 'z', sentAt: '2026-10-29T10:00:00Z' }, { id: 'a', sentAt: '2026-10-29T10:02:00Z' }];
    const result = mergeChatPage(current, [{ id: 'b', sentAt: '2026-10-29T10:01:00Z' }], { messages: true });
    expect(result.map(item => item.id)).toEqual(['z', 'b', 'a']);
    expect(mergeChatPage(result, [{ ...current[0] }, { ...result[1] }], { messages: true }).map(item => item.id)).toEqual(['z', 'b', 'a']);
  });
});

it('requests offset after loaded records and stops when an old server repeats a page', async () => {
  const loader = vi.fn().mockResolvedValue({ messages: [{ id: 'a' }, { id: 'b' }], hasMore: true });
  const { result } = renderHook(() => useChatPages('operation', loader, { messages: true }));
  await waitFor(() => expect(result.current.items).toHaveLength(2));
  await act(async () => { await result.current.loadMore(); });
  expect(loader.mock.calls[1][1].offset).toBe(2);
  expect(result.current.hasMore).toBe(false);
  expect(result.current.noProgress).toBe(true);
});

it('coalesces polling and observer refreshes while a read is pending', async () => {
  let resolve;
  const loader = vi.fn(() => new Promise(done => { resolve = done; }));
  const { result } = renderHook(() => useChatPages('station', loader));
  await act(async () => { await result.current.refresh(); });
  expect(loader).toHaveBeenCalledTimes(1);
  await act(async () => { resolve({ conversations: [], hasMore: false }); });
});

it('preserves a canonical POST received while a previous GET is still pending', async () => {
  const operationId = 'operation-a';
  const first = { id: 'first', operationId, sentAt: '2026-10-29T10:00:00Z' };
  const sent = { id: 'sent', operationId, sentAt: '2026-10-29T10:01:00Z' };
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const loader = vi.fn().mockResolvedValueOnce({ messages: [first], hasMore: false }).mockReturnValueOnce(pending);
  const { result } = renderHook(() => useChatPages(operationId, loader, { messages: true }));
  await waitFor(() => expect(result.current.items).toEqual([first]));
  let refreshing;
  act(() => { refreshing = result.current.refresh(); });
  act(() => { result.current.append(sent); });
  expect(result.current.items.map(item => item.id)).toEqual(['first', 'sent']);
  await act(async () => { resolve({ messages: [first], hasMore: false }); await refreshing; });
  expect(result.current.items.map(item => item.id)).toEqual(['first', 'sent']);
});
