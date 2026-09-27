import { useEffect } from 'react';

const FALLBACK_POLL_MS = 25_000;

/** Re-read HTTP independently of the change cursor, including after a failed refresh. */
export function useCommercialRevalidation(reload) {
  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    const onVisibility = () => refreshVisible();
    const poll = window.setInterval(refreshVisible, FALLBACK_POLL_MS);
    window.addEventListener('focus', refreshVisible);
    window.addEventListener('online', refreshVisible);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener('focus', refreshVisible);
      window.removeEventListener('online', refreshVisible);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reload]);
}
