import { useCallback, useState } from 'react';

// Estado abrir/cerrar reutilizable para drawers, modales y menús —
// evita repetir `useState` + tres callbacks en cada feature que los use.
export function useDisclosure(initialOpen = false) {
  const [isOpen, setIsOpen] = useState(initialOpen);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen(value => !value), []);

  return { isOpen, open, close, toggle };
}
