import { MEDIA_QUERIES } from '../../config/breakpoints';
import { useMediaQuery } from '../../hooks/useMediaQuery';

// Mismo umbral que el Sidebar (por debajo de `lg`): ahí la lista lateral pasa
// a un drawer y el mapa ocupa todo el ancho.
export function useIsTabletBreakpoint() {
  return useMediaQuery(MEDIA_QUERIES.belowDesktop);
}
