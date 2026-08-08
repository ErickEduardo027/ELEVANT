import { useEffect } from 'react';

export function useEscapeToClose(active, onClose) {
  useEffect(() => {
    if (!active) return undefined;
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [active, onClose]);
}
