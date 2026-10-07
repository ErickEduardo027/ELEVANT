import { useWindowDimensions } from 'react-native';

export type LayoutClass = 'compact' | 'medium' | 'expanded';

// Mismos cortes que las clases de ventana de Android (dp): teléfono vertical,
// teléfono horizontal o tablet vertical, y tablet horizontal o grande.
export const MEDIUM_MIN_WIDTH = 600;
export const EXPANDED_MIN_WIDTH = 900;

export function layoutClassFor(width: number): LayoutClass {
  if (width >= EXPANDED_MIN_WIDTH) return 'expanded';
  if (width >= MEDIUM_MIN_WIDTH) return 'medium';
  return 'compact';
}

/** Clase de layout del ancho actual; cambia al rotar o redimensionar la ventana. */
export function useLayoutClass(): LayoutClass {
  const { width } = useWindowDimensions();
  return layoutClassFor(width);
}
