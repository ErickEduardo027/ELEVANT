import { useCallback, useRef, useState } from 'react';

let toastSequence = 0;

// Cola mínima de notificaciones toast, pensada para confirmar operaciones
// asíncronas (activar cuenta, reenviar invitación, etc.) sin bloquear la UI.
export function useToast() {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismissToast = useCallback(id => {
    setToasts(current => current.filter(toast => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    // `action` ({ label, onClick }) adds a button such as «Abrir»; the toast never takes focus.
    (message, tone = 'success', durationMs = 4000, action = null) => {
      const id = `toast-${(toastSequence += 1)}`;
      setToasts(current => [...current, { id, message, tone, action }]);
      timers.current.set(
        id,
        setTimeout(() => dismissToast(id), durationMs)
      );
      return id;
    },
    [dismissToast]
  );

  return { toasts, showToast, dismissToast };
}
