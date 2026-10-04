import { useRef, useSyncExternalStore } from 'react';

/** Test-only URL seed for components migrated from React Router to Next hooks. */
export function MemoryRouter({ initialEntries = ['/'], children }) {
  const initialLocation = useRef(initialEntries[0]);
  if (window.location.pathname + window.location.search !== initialLocation.current) {
    window.history.replaceState({}, '', initialLocation.current);
  }
  return children;
}

export function useLocation() {
  const subscribe = listener => {
    window.addEventListener('popstate', listener);
    return () => window.removeEventListener('popstate', listener);
  };
  const pathname = useSyncExternalStore(subscribe, () => window.location.pathname, () => '/');
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => '');
  return { pathname, search };
}
