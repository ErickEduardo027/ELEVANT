import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

globalThis.__nextRouterMock = {
  push: href => {
    window.history.pushState({}, '', href);
    window.dispatchEvent(new PopStateEvent('popstate'));
  },
  replace: href => {
    window.history.replaceState({}, '', href);
    window.dispatchEvent(new PopStateEvent('popstate'));
  },
  refresh: () => {}, back: () => {}, forward: () => {},
};

vi.mock('next/navigation', async () => {
  const React = await import('react');
  const subscribe = listener => {
    window.addEventListener('popstate', listener);
    return () => window.removeEventListener('popstate', listener);
  };
  const usePath = () => React.useSyncExternalStore(
    subscribe, () => window.location.pathname, () => '/',
  );
  const useSearch = () => React.useSyncExternalStore(
    subscribe, () => window.location.search, () => '',
  );
  return {
    useRouter: () => globalThis.__nextRouterMock,
    usePathname: usePath,
    useSearchParams: () => new URLSearchParams(useSearch()),
    useParams: () => ({}),
  };
});
