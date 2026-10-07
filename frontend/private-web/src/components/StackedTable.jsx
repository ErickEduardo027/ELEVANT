import { useEffect, useRef } from 'react';

function labelCells(root) {
  root.querySelectorAll('table.table-stack').forEach(table => {
    const labels = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
    table.querySelectorAll('tbody > tr').forEach(row => {
      let column = 0;
      [...row.children].forEach(cell => {
        if (!cell.hasAttribute('data-label') || cell.dataset.autoLabel === 'true') {
          cell.setAttribute('data-label', cell.colSpan > 1 ? '' : labels[column] ?? '');
          cell.dataset.autoLabel = 'true';
        }
        column += cell.colSpan || 1;
      });
    });
  });
}

// Contenedor de tablas anchas: en tablet y escritorio desplaza en horizontal;
// por debajo de `md` las tablas con la clase `table-stack` se apilan como
// tarjetas (ver tokens.css). Copia el texto de cada encabezado a `data-label`
// para que las celdas conserven su etiqueta sin duplicar el contenido en el DOM.
export default function StackedTable({ children, className = '' }) {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    labelCells(root);
    if (typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(() => labelCells(root));
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`overflow-x-auto max-md:overflow-x-visible ${className}`}>
      {children}
    </div>
  );
}
