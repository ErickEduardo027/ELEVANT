// Cabecera estándar de página: antetítulo, título, descripción y acciones.
// Las acciones bajan bajo el título cuando no caben en la misma fila.
export default function PageHeader({ eyebrow, title, description, actions, children, className = '' }) {
  return (
    <header data-occ-header className={`flex flex-wrap items-end justify-between gap-x-4 gap-y-3 ${className}`}>
      <div className="min-w-0 max-w-3xl">
        {eyebrow && (
          <p className="text-xs font-bold uppercase tracking-[.18em] text-signal-500">{eyebrow}</p>
        )}
        <h1 className="mt-1 text-2xl font-bold text-ink-900 dark:text-text-primary-dark sm:text-3xl">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">{description}</p>
        )}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
