import { useEffect, useState } from 'react';

function matches(query) {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.(query).matches);
}

// Sin `matchMedia` (SSR, jsdom) devuelve false: los componentes renderizan su
// presentación de escritorio y se ajustan al hidratar en el navegador.
export function useMediaQuery(query) {
  const [matched, setMatched] = useState(() => matches(query));

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const onChange = event => setMatched(event.matches);
    mql.addEventListener?.('change', onChange);
    setMatched(mql.matches);
    return () => mql.removeEventListener?.('change', onChange);
  }, [query]);

  return matched;
}
