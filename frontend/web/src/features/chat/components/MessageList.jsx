import { useEffect, useRef, useState } from 'react';
import { groupMessagesByDate } from '../chatMappers';
import MessageItem from './MessageItem';
import SystemEvent from './SystemEvent';

const NEAR_BOTTOM_THRESHOLD_PX = 120;

export default function MessageList({ messages, nowIso }) {
  const containerRef = useRef(null);
  const previousCountRef = useRef(messages.length);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [hasNewMessage, setHasNewMessage] = useState(false);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX;
    setIsNearBottom(nearBottom);
    if (nearBottom) setHasNewMessage(false);
  }

  useEffect(() => {
    const grew = messages.length > previousCountRef.current;
    previousCountRef.current = messages.length;
    const el = containerRef.current;
    if (!el || !grew) return;

    if (isNearBottom) {
      el.scrollTop = el.scrollHeight;
    } else {
      setHasNewMessage(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // Al montar (cambio de conversación seleccionada) siempre inicia al final del historial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function scrollToBottom() {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setHasNewMessage(false);
  }

  const groups = groupMessagesByDate(messages, nowIso);

  return (
    <div className="relative flex-1 overflow-hidden">
      <div ref={containerRef} onScroll={handleScroll} data-testid="message-list" className="h-full space-y-4 overflow-y-auto px-4 py-3">
        {groups.map(group => (
          <div key={group.key} className="space-y-2">
            <div className="flex justify-center">
              <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary-light dark:bg-white/10 dark:text-text-secondary-dark">
                {group.label}
              </span>
            </div>
            <div className="space-y-2">
              {group.items.map(message => (message.type === 'system' ? <SystemEvent key={message.id} message={message} /> : <MessageItem key={message.id} message={message} />))}
            </div>
          </div>
        ))}
      </div>

      {hasNewMessage && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-accent-600 px-3 py-1 text-xs font-semibold text-white shadow-lg"
        >
          Nuevo mensaje
        </button>
      )}
    </div>
  );
}
