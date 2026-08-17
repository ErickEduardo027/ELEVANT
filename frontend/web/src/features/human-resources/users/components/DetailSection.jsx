// Generaliza el patrón ReviewSection de feat/adminocc: encabezado en
// mayúsculas + contenido, usado en cada pestaña del panel de detalle.
export default function DetailSection({ title, children }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
        {title}
      </h4>
      {children}
    </div>
  );
}

export function DetailRow({ label, value }) {
  return (
    <div>
      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{label}</p>
      <p className="text-sm text-ink-900 dark:text-text-primary-dark">{value}</p>
    </div>
  );
}
