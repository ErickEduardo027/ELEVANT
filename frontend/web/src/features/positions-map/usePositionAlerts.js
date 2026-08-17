import { useEffect, useRef, useState } from 'react';
import { buildDisabledToast } from './positionsMapMappers';

const MAX_VISIBLE_TOASTS = 3;
const TOAST_TTL_MS = 6000;

// El frontend nunca inventa el evento de inhabilitación: solo reacciona cuando una posición que
// no estaba inhabilitada pasa a estarlo por una configuración combinada recibida de los datos.
function buildAlert(previous, next) {
  if (previous.status !== 'disabled' && next.status === 'disabled' && next.combinedConfiguration) {
    return { kind: 'disabled', ...buildDisabledToast(next) };
  }
  return null;
}

export function usePositionAlerts(positions, connection) {
  const previousRef = useRef(new Map());
  const idCounterRef = useRef(0);
  const mountedRef = useRef(true);
  const previousConnectionRef = useRef(connection);
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function enqueueToast(id, toast) {
    setToasts(current => [...current, { id, ...toast }].slice(-MAX_VISIBLE_TOASTS));
    setTimeout(() => {
      if (mountedRef.current) setToasts(current => current.filter(existing => existing.id !== id));
    }, TOAST_TTL_MS);
  }

  useEffect(() => {
    const previous = previousRef.current;
    const next = new Map();

    positions.forEach(position => {
      next.set(position.id, position);
      const prevPosition = previous.get(position.id);
      if (!prevPosition) return;

      const alert = buildAlert(prevPosition, position);
      if (!alert) return;

      enqueueToast(`toast-${position.id}-${idCounterRef.current++}`, alert);
    });

    previousRef.current = next;
  }, [positions]);

  useEffect(() => {
    const wasAlreadyDisconnected = previousConnectionRef.current === 'disconnected';
    previousConnectionRef.current = connection;
    if (connection !== 'disconnected' || wasAlreadyDisconnected) return;

    enqueueToast(`toast-connection-${idCounterRef.current++}`, {
      kind: 'error',
      title: 'Sin conexión con el proveedor de posiciones',
      description: 'Los datos no se están actualizando.',
    });
  }, [connection]);

  function dismissToast(id) {
    setToasts(current => current.filter(toast => toast.id !== id));
  }

  return { toasts, dismissToast };
}
