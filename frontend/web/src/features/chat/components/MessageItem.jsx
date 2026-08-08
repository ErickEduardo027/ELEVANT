import { formatClockTime } from '../../dashboard/mappers';
import { CheckCheckIcon } from '../../notifications/components/icons';
import AttachmentPreview from './AttachmentPreview';
import { CheckIcon } from './icons';

function DeliveryStatus({ status }) {
  if (status === 'read') return <CheckCheckIcon className="h-3 w-3 text-accent-600" />;
  if (status === 'delivered') return <CheckCheckIcon className="h-3 w-3 text-text-secondary-light dark:text-text-secondary-dark" />;
  if (status === 'sent') return <CheckIcon className="h-3 w-3 text-text-secondary-light dark:text-text-secondary-dark" />;
  return null;
}

export default function MessageItem({ message }) {
  const isOcc = message.senderRole === 'occ';

  return (
    <div data-testid="message-item" className={`flex ${isOcc ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[75%] space-y-1.5 ${isOcc ? 'items-end' : 'items-start'}`}>
        {!isOcc && (
          <p className="px-1 text-[11px] font-medium text-text-secondary-light dark:text-text-secondary-dark">{message.senderName}</p>
        )}
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            isOcc
              ? 'bg-accent-600 text-white'
              : 'border border-black/5 bg-white/80 text-ink-900 dark:border-white/5 dark:bg-surface-dark-card dark:text-text-primary-dark'
          }`}
        >
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>

        {message.attachments?.length > 0 && (
          <div className="space-y-1.5">
            {message.attachments.map(attachment => (
              <AttachmentPreview key={attachment.id} attachment={attachment} />
            ))}
          </div>
        )}

        <div className={`flex items-center gap-1 px-1 text-[10px] text-text-secondary-light dark:text-text-secondary-dark ${isOcc ? 'justify-end' : 'justify-start'}`}>
          <span>{formatClockTime(message.createdAt)}</span>
          {isOcc && <DeliveryStatus status={message.status} />}
        </div>
      </div>
    </div>
  );
}
