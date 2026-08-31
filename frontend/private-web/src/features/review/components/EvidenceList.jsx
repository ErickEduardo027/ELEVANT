import ReviewSection from './ReviewSection';
import { formatClockTime } from '../reviewMappers';
import { CameraIcon, FileTextIcon } from './icons';
import { ClipboardIcon } from '../../planning/components/icons';

const TYPE_META = {
  photo: { label: 'Fotografía', icon: CameraIcon },
  document: { label: 'Documento', icon: FileTextIcon },
  record: { label: 'Registro', icon: FileTextIcon },
  checklist: { label: 'Checklist', icon: ClipboardIcon },
  observation: { label: 'Observación', icon: FileTextIcon },
};

export default function EvidenceList({ evidence = [] }) {
  return (
    <ReviewSection title="Evidencias">
      {evidence.length === 0 ? (
        <p className="text-text-secondary-light dark:text-text-secondary-dark">Sin evidencias adjuntas.</p>
      ) : (
        <ul className="space-y-1.5">
          {evidence.map(item => {
            const meta = TYPE_META[item.type] ?? TYPE_META.document;
            const Icon = meta.icon;
            return (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-lg border border-black/5 px-3 py-1.5 dark:border-white/5"
              >
                <Icon className="h-4 w-4 shrink-0 text-accent-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink-900 dark:text-text-primary-dark">{item.name}</p>
                  <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                    {meta.label} · {item.user} · {formatClockTime(item.date)}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-xs font-medium ${
                    item.status === 'available' ? 'text-status-success' : 'text-status-warning'
                  }`}
                >
                  {item.status === 'available' ? 'Disponible' : 'Pendiente'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </ReviewSection>
  );
}
