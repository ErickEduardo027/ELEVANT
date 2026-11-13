import { useEffect } from 'react';

// Generalizado desde el hook homónimo de `feat/adminocc` (feature de
// notificaciones): cierra drawers/modales con Escape sin que cada
// componente repita el listener.
export function useEscapeToClose(active, onClose) {
  useEffect(() => {
    if (!active) return undefined;

    // Closing marks the Escape as used (contracts 2.2): the OCC map keys skip a used key and stand still while a
    // modal is open, so one Escape closes the drawer and the next clears the map selection. There is no
    // `defaultPrevented` check here: with two modals open, the one opened first listens first, and the one on top
    // would then stay open.
    function handleKeyDown(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, onClose]);
}
