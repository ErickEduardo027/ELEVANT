import { useId } from 'react';
import { XIcon } from '../../shell/components/icons';
import { useEscapeToClose } from '../../../hooks/useEscapeToClose';
import { useDialogFocus } from '../../../hooks/useDialogFocus';

// Vista ampliada de un panel geográfico de la consola: diálogo modal casi a pantalla
// completa que se cierra con su botón, con Escape o pulsando el fondo, y devuelve el foco
// al control que lo abrió. El contenido decide si muestra un panel lateral.
export default function MapExpandDialog({ title, note, closeLabel, onClose, actions, aside, children }) {
  useEscapeToClose(true, onClose);
  const dialogRef = useDialogFocus(true);
  const titleId = useId();

  return (
    <div className="fixed inset-0 z-modal flex p-0 sm:p-4 lg:p-6">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-ink-900/60" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="relative flex min-h-0 w-full flex-col overflow-hidden bg-occ-panel shadow-2xl sm:rounded-xl sm:border sm:border-occ-line">
        <header className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 border-b border-occ-line px-4 py-2">
          <h2 id={titleId} className="text-sm font-semibold text-occ-text">{title}</h2>
          {note && <p className="hidden text-xs text-occ-muted md:block">{note}</p>}
          <div className="ml-auto flex items-center gap-2">
            {actions}
            <button type="button" onClick={onClose}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-occ-line px-3 text-xs font-semibold text-occ-text hover:bg-occ-panel-muted">
              <XIcon className="h-3.5 w-3.5" />{closeLabel}
            </button>
          </div>
        </header>
        <div className={`grid min-h-0 flex-1 ${aside ? 'grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-1' : ''}`}>
          <div className="relative min-h-[50dvh] lg:min-h-0">{children}</div>
          {aside && <aside className="max-h-[38dvh] overflow-y-auto border-t border-occ-line lg:max-h-none lg:border-l lg:border-t-0">{aside}</aside>}
        </div>
      </div>
    </div>
  );
}

export function ExpandIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5" />
    </svg>
  );
}

export function ExpandButton({ label, onClick, buttonRef }) {
  return (
    <button ref={buttonRef} type="button" onClick={onClick} aria-haspopup="dialog"
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-occ-line bg-occ-panel px-2.5 text-xs font-semibold text-occ-text hover:border-occ-line-strong">
      <ExpandIcon className="h-3.5 w-3.5" />{label}
    </button>
  );
}
