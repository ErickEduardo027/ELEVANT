import { useEffect, useRef } from 'react';

function labelCells(root) {
  root.querySelectorAll('table.table-stack').forEach(table => {
    const labels = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
    table.querySelectorAll('tbody > tr').forEach(row => {
      let column = 0;
      [...row.children].forEach(cell => {
        if (!cell.hasAttribute('data-label') || cell.dataset.autoLabel === 'true') {
          const label = cell.colSpan > 1 ? '' : labels[column] ?? '';
          if (cell.getAttribute('data-label') !== label) cell.setAttribute('data-label', label);
          cell.dataset.autoLabel = 'true';
        }
        column += cell.colSpan || 1;
      });
    });
  });
}

// Copia el texto de cada encabezado a `data-label` en las celdas de las tablas
// `table-stack` bajo `ref`, también cuando las filas cambian. El CSS de
// tokens.css usa esa etiqueta para presentar cada fila como
// tarjeta sin duplicar el contenido en el DOM cuando su contenedor es estrecho.
export function useStackedTableLabels(ref, resetKey) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    labelCells(root);
    if (typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(() => labelCells(root));
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [ref, resetKey]);
}

// Contenedor de tablas anchas fuera del shell: en tablet y escritorio desplaza
// en horizontal; en contenedores estrechos las tablas `table-stack` se apilan.
export default function StackedTable({ children, className = '' }) {
  const ref = useRef(null);
  useStackedTableLabels(ref);

  return (
    <div ref={ref} className={`overflow-x-auto ${className}`}>
      {children}
    </div>
  );
}
