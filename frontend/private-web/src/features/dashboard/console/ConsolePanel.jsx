import { useId } from 'react';
import Link from 'next/link';

// Región de la consola OCC: una sola superficie con encabezado compacto. Las
// listas internas usan separadores, no tarjetas anidadas.
export default function ConsolePanel({ title, meta, actions, children, className = '', bodyClassName = '' }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}
      className={`flex min-w-0 flex-col overflow-hidden rounded-xl border border-occ-line bg-occ-panel ${className}`}>
      <header className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-occ-line px-4 py-2">
        <h2 id={headingId} className="text-[13px] font-semibold tracking-tight text-occ-text">{title}</h2>
        {meta && <div className="text-xs text-occ-muted">{meta}</div>}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function PanelLink({ href, children }) {
  return <Link href={href}
    className="inline-flex min-h-8 items-center rounded-md px-2 text-xs font-semibold text-occ-accent hover:bg-occ-accent-soft">
    {children}
  </Link>;
}
