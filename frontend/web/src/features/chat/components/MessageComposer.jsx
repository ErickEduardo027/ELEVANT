import { useRef, useState } from 'react';
import AttachmentPreview from './AttachmentPreview';
import { PaperclipIcon, SendIcon } from './icons';

export default function MessageComposer({ onSend, disabled = false }) {
  const [value, setValue] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const fileInputRef = useRef(null);

  const canSend = !disabled && (value.trim().length > 0 || pendingAttachments.length > 0);

  function handleSend() {
    if (!canSend) return;
    onSend(value.trim(), pendingAttachments);
    setValue('');
    setPendingAttachments([]);
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  function handleFileChange(event) {
    const files = Array.from(event.target.files ?? []);
    const attachments = files.map((file, index) => ({
      id: `pending-${Date.now()}-${index}`,
      name: file.name,
      type: file.type.startsWith('image/') ? 'image' : 'document',
      size: file.size,
      status: 'ready',
    }));
    setPendingAttachments(current => [...current, ...attachments]);
    event.target.value = '';
  }

  return (
    <div className="space-y-2 border-t border-black/5 px-4 py-3 dark:border-white/5">
      {pendingAttachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {pendingAttachments.map(attachment => (
            <AttachmentPreview key={attachment.id} attachment={attachment} />
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} aria-hidden="true" tabIndex={-1} />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          aria-label="Adjuntar archivo"
          className="shrink-0 rounded-lg border border-black/10 p-2 text-text-secondary-light hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-text-secondary-dark dark:hover:bg-white/5"
        >
          <PaperclipIcon className="h-4 w-4" />
        </button>

        <textarea
          value={value}
          onChange={event => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
          placeholder={disabled ? 'La conversación está cerrada.' : 'Escriba un mensaje...'}
          aria-label="Mensaje"
          className="max-h-32 min-h-[38px] flex-1 resize-none rounded-lg border border-black/10 bg-white/80 px-3 py-2 text-sm text-ink-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
        />

        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Enviar mensaje"
          className={`shrink-0 rounded-lg p-2.5 text-white transition-colors duration-200 ${
            canSend ? 'bg-accent-600 hover:bg-accent-600/90' : 'cursor-not-allowed bg-accent-600/40'
          }`}
        >
          <SendIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
