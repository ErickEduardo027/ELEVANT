import { MessageCircleIcon } from '../../shell/components/icons';

const VARIANT_COPY = {
  'no-conversations': {
    title: 'No hay conversaciones disponibles',
    description: 'Las conversaciones con los agentes de rampa aparecerán aquí a medida que se asignen operaciones.',
  },
  'no-results': {
    title: 'No se encontraron conversaciones',
    description: 'Ajuste la búsqueda o los filtros para ver más resultados.',
  },
  'no-selection': {
    title: 'Selecciona una conversación para comenzar',
    description: 'Elija una conversación de la lista para ver el historial y responder al agente.',
  },
};

export default function ChatEmptyState({ variant = 'no-selection' }) {
  const copy = VARIANT_COPY[variant] ?? VARIANT_COPY['no-selection'];

  return (
    <div
      data-testid="chat-empty-state"
      className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center"
    >
      <MessageCircleIcon className="h-6 w-6 text-text-secondary-light dark:text-text-secondary-dark" />
      <p className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{copy.title}</p>
      <p className="max-w-sm text-xs text-text-secondary-light dark:text-text-secondary-dark">{copy.description}</p>
    </div>
  );
}
