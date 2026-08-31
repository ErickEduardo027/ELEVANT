import { formatFileSize } from '../chatMappers';
import { FileGenericIcon, ImageIcon } from './icons';

const STATUS_LABEL = {
  uploading: 'Cargando…',
  ready: 'Listo',
  error: 'Error al cargar',
};

export default function AttachmentPreview({ attachment }) {
  const Icon = attachment.type === 'image' ? ImageIcon : FileGenericIcon;

  return (
    <div
      data-testid="attachment-preview"
      className="flex items-center gap-2 rounded-lg border border-black/10 bg-white/70 px-2.5 py-1.5 dark:border-white/10 dark:bg-surface-dark-card"
    >
      <Icon className="h-4 w-4 shrink-0 text-text-secondary-light dark:text-text-secondary-dark" />
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-ink-900 dark:text-text-primary-dark">{attachment.name}</p>
        <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
          {formatFileSize(attachment.size)} · {STATUS_LABEL[attachment.status] ?? attachment.status}
        </p>
      </div>
    </div>
  );
}
