import { formatClockTime } from '../../dashboard/mappers';

export default function SystemEvent({ message }) {
  return (
    <div data-testid="system-event" className="flex items-center justify-center py-1">
      <span className="max-w-[85%] rounded-full bg-black/5 px-3 py-1 text-center text-[11px] text-text-secondary-light dark:bg-white/10 dark:text-text-secondary-dark">
        {message.content} <span className="opacity-70">· {formatClockTime(message.createdAt)}</span>
      </span>
    </div>
  );
}
