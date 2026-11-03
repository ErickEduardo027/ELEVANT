// Barra de filtros: en teléfono cada control ocupa el ancho completo (o media
// fila con `compact`), en tablet forma una rejilla y en escritorio fluye en
// línea. Los hijos deben ser etiquetas/controles sin anchos mínimos propios.
export default function FilterBar({ children, actions, className = '' }) {
  return (
    <div data-occ-toolbar className={`flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end ${className}`}>
      <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:flex lg:flex-wrap lg:items-end [&>*]:min-w-0 lg:[&>*]:min-w-[10rem] lg:[&>*]:flex-1">
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
