import { useEffect, useState } from 'react';
import { useEscapeToClose } from '../../../hooks/useEscapeToClose';
import { XIcon } from '../../review/components/icons';

export default function NewConversationDrawer({ open, options, onCreate, onClose }) {
  const [selectedFlightId, setSelectedFlightId] = useState('');

  useEscapeToClose(open, onClose);

  useEffect(() => {
    if (open) setSelectedFlightId('');
  }, [open]);

  if (!open) return null;

  const selected = options.find(option => String(option.flightId) === selectedFlightId) ?? null;

  function handleCreate() {
    if (!selected) return;
    onCreate(selected);
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink-900/40 backdrop-blur-sm transition-opacity duration-200" onClick={onClose} />
      <aside
        data-testid="new-conversation-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-conversation-title"
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-black/5 bg-white/95 shadow-lg backdrop-blur-md transition-transform duration-200 dark:border-white/5 dark:bg-surface-dark-card lg:w-[440px]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-black/5 px-5 py-4 dark:border-white/5">
          <div>
            <p id="new-conversation-title" className="text-base font-semibold text-ink-900 dark:text-text-primary-dark">
              Nueva conversación
            </p>
            <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
              Seleccione el vuelo/operación para iniciar la comunicación con el agente asignado.
            </p>
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-secondary-light hover:bg-black/5 dark:text-text-secondary-dark dark:hover:bg-white/5"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {options.length === 0 ? (
            <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
              No hay vuelos/operaciones disponibles para iniciar una nueva conversación en este momento.
            </p>
          ) : (
            <label className="flex flex-col gap-1.5 text-xs text-text-secondary-light dark:text-text-secondary-dark">
              Vuelo / operación
              <select
                value={selectedFlightId}
                onChange={event => setSelectedFlightId(event.target.value)}
                className="rounded-lg border border-black/10 bg-white/80 px-3 py-2 text-sm text-ink-900 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
              >
                <option value="" disabled>
                  Seleccione un vuelo
                </option>
                {options.map(option => (
                  <option key={option.flightId} value={option.flightId}>
                    {option.flightNumber} · {option.airline} · {option.origin} → {option.destination}
                  </option>
                ))}
              </select>
            </label>
          )}

          {selected && (
            <div className="space-y-1.5 rounded-xl border border-black/5 p-3 text-xs dark:border-white/5">
              <p>
                <span className="text-text-secondary-light dark:text-text-secondary-dark">Operación: </span>
                <span className="font-medium text-ink-900 dark:text-text-primary-dark">{selected.operationId}</span>
              </p>
              <p>
                <span className="text-text-secondary-light dark:text-text-secondary-dark">Posición: </span>
                <span className="font-medium text-ink-900 dark:text-text-primary-dark">{selected.position}</span>
              </p>
              <p>
                <span className="text-text-secondary-light dark:text-text-secondary-dark">Agente: </span>
                <span className="font-medium text-ink-900 dark:text-text-primary-dark">{selected.agentName}</span>
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-black/5 px-5 py-4 dark:border-white/5">
          <button
            type="button"
            onClick={handleCreate}
            disabled={!selected}
            className={`w-full rounded-lg px-3 py-2 text-sm font-semibold text-white transition-colors duration-200 ${
              selected ? 'bg-accent-600 hover:bg-accent-600/90' : 'cursor-not-allowed bg-accent-600/40'
            }`}
          >
            Iniciar conversación
          </button>
        </div>
      </aside>
    </>
  );
}
