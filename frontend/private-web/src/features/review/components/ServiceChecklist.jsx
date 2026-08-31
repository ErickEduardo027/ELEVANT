import ReviewSection from './ReviewSection';

const STATUS_META = {
  completed: { label: 'Completado', className: 'text-status-success' },
  not_required: { label: 'No requerido', className: 'text-text-secondary-light dark:text-text-secondary-dark' },
  pending: { label: 'Pendiente', className: 'text-status-warning' },
};

export default function ServiceChecklist({ services = [] }) {
  return (
    <ReviewSection title="Servicios">
      {services.length === 0 ? (
        <p className="text-text-secondary-light dark:text-text-secondary-dark">Sin servicios registrados.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {services.map(service => {
            const meta = STATUS_META[service.status] ?? { label: service.status, className: '' };
            return (
              <li
                key={service.name}
                className="flex items-center justify-between rounded-lg border border-black/5 px-3 py-1.5 dark:border-white/5"
              >
                <span>{service.name}</span>
                <span className={`text-xs font-medium ${meta.className}`}>{meta.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </ReviewSection>
  );
}
