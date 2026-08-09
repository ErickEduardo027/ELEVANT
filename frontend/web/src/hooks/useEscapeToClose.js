import { useEffect } from 'react';

// Generalizado desde el hook homónimo de `feat/adminocc` (feature de
// notificaciones): cierra drawers/modales con Escape sin que cada
// componente repita el listener.
export function useEscapeToClose(active, onClose) {
  useEffect(() => {
    if (!active) return undefined;

    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, onClose]);
}
